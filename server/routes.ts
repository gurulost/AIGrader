import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { configureAuth } from "./auth";
import { submissionQueue } from "./queue/worker";
import multer from "multer";
import path from "path";
import * as fs from 'fs';
import { StorageService } from "./services/storage-service";
import { AIService } from "./services/ai-service";
import { GeminiAdapter, SUPPORTED_MIME_TYPES } from "./adapters/gemini-adapter";
import { OpenAIAdapter } from "./adapters/openai-adapter";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { db } from "./db";
import { submissions, feedback, users, type User } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { defaultRateLimiter, submissionRateLimiter } from "./middleware/rate-limiter";
import adminRoutes from "./routes/admin";
import instructorRoutes from "./routes/instructor";
import { determineContentType, isFileTypeAllowed, ContentType } from "./utils/file-type-settings";
import { processFileForMultimodal } from "./utils/multimodal-processor";
import { asyncHandler } from "./lib/error-handler";

// Helper function to generate a unique shareable code for assignments
function generateShareableCode(length = 8): string {
  // Generate a random UUID
  const uuid = uuidv4();
  
  // Convert to alphanumeric characters by removing dashes and taking first 'length' characters
  // Always use uppercase for consistency in storage
  const code = uuid.replace(/-/g, '').substring(0, length).toUpperCase();
  
  console.log(`Generated shareable code: ${code}`);
  return code;
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication
  const { requireAuth, requireRole } = configureAuth(app);
  
  // Initialize services
  const storageService = new StorageService();
  
  // Mount admin routes
  app.use('/api/admin', adminRoutes);
  
  // Mount instructor routes
  app.use('/api/instructor', instructorRoutes);
  
  // Define API routes
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Authentication endpoints handled in auth.ts

  // Assignment endpoints
  app.get('/api/assignments', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as any;
    let assignments;
    
    if (user.role === 'student') {
      assignments = await storage.listAssignmentsForUser(user.id);
      
      // For each assignment, get the latest submission
      const assignmentsWithSubmissions = await Promise.all(
        assignments.map(async (assignment) => {
          const submission = await storage.getLatestSubmission(user.id, assignment.id);
          const course = await storage.getCourse(assignment.courseId);
          return {
            ...assignment,
            submissions: submission ? [submission] : [],
            course
          };
        })
      );
      
      res.json(assignmentsWithSubmissions);
    } else {
      // For instructors, return all assignments with submission counts
      assignments = await storage.listAssignments();
      
      const assignmentsWithStats = await Promise.all(
        assignments.map(async (assignment) => {
          const submissions = await storage.listSubmissionsForAssignment(assignment.id);
          const course = await storage.getCourse(assignment.courseId);
          const students = await storage.listCourseEnrollments(assignment.courseId);
          
          const submittedCount = new Set(submissions.map(s => s.userId)).size;
          
          return {
            ...assignment,
            submittedCount,
            totalStudents: students.length,
            submissionPercentage: students.length > 0 ? (submittedCount / students.length) * 100 : 0,
            course
          };
        })
      );
      
      res.json(assignmentsWithStats);
    }
  }));

  // Get specific assignment
  app.get('/api/assignments/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const assignmentId = parseInt(req.params.id);
    const assignment = await storage.getAssignment(assignmentId);
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    const course = await storage.getCourse(assignment.courseId);
    
    res.json({
      ...assignment,
      course
    });
  }));

  // Create assignment (instructor only)
  app.post('/api/assignments', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, dueDate, rubric } = req.body;
      
      console.log("Creating assignment with data:", JSON.stringify({
        title, 
        description: description?.substring(0, 30) + "...", 
        courseId,
        dueDate
      }));
      
      // Validate request
      const assignmentSchema = z.object({
        title: z.string().min(3),
        description: z.string().min(10),
        courseId: z.union([
          z.number().int().positive(),
          z.string().transform(val => parseInt(val))
        ]).optional(), // Make optional for standalone assignments
        dueDate: z.string().refine(val => !isNaN(Date.parse(val)), {
          message: 'Invalid date format'
        }),
        rubric: z.object({
          criteria: z.array(z.object({
            id: z.string(),
            type: z.string(),
            name: z.string(),
            description: z.string(),
            maxScore: z.number().int().min(1),
            weight: z.number().int().min(1),
          })).optional(),
          totalPoints: z.number().int().positive().optional(),
          passingThreshold: z.number().int().min(0).max(100).optional(),
        }).optional(),
      });
      
      const result = assignmentSchema.safeParse(req.body);
      if (!result.success) {
        const errorDetails = JSON.stringify(result.error.format());
        console.error("Assignment validation failed:", errorDetails);
        return res.status(400).json({ 
          message: 'Invalid assignment data', 
          errors: result.error.format() 
        });
      }
      
      // Check if course exists (if courseId is provided)
      if (courseId) {
        const courseIdNum = typeof courseId === 'string' ? parseInt(courseId) : courseId;
        const course = await storage.getCourse(courseIdNum);
        if (!course) {
          return res.status(404).json({ message: 'Course not found' });
        }
      }
      
      // Generate a unique shareable code
      const shareableCode = generateShareableCode();
      
      // Create assignment
      const courseIdNum = courseId ? (typeof courseId === 'string' ? parseInt(courseId) : courseId) : undefined;
      const assignment = await storage.createAssignment({
        title,
        description,
        courseId: courseIdNum, // Now properly parsed and optional
        dueDate: new Date(dueDate), // The client already sends an ISO string, so we just need a Date object
        status: 'active', // Setting to active by default so students can submit immediately
        shareableCode,
        rubric: rubric ? JSON.stringify(rubric) as any : null,
      });
      
      console.log("Assignment created successfully, ID:", assignment.id);
      return res.status(201).json(assignment);
    } catch (error) {
      console.error("Error creating assignment:", error);
      return res.status(500).json({ 
        message: 'Failed to create assignment', 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }));

  // Get assignment details for instructor
  app.get('/api/assignments/:id/details', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
    const assignmentId = parseInt(req.params.id);
    // Get the basic assignment data
    let assignment;
    try {
      assignment = await storage.getAssignment(assignmentId);
    } catch (err) {
      console.error('Error retrieving assignment:', err);
      // Generate minimal assignment data for UI to work with
      const assignments = await storage.listAssignments();
      assignment = assignments.find(a => a.id === assignmentId);
      
      if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
    }
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    // Get additional data with error handling
    let course = null;
    let submissions: any[] = [];
    let students: any[] = [];
    
    try {
      course = await storage.getCourse(assignment.courseId);
    } catch (err) {
      console.error('Error fetching course:', err);
    }
    
    try {
      submissions = await storage.listSubmissionsForAssignment(assignment.id);
    } catch (err) {
      console.error('Error fetching submissions:', err);
    }
    
    try {
      students = await storage.listCourseEnrollments(assignment.courseId);
    } catch (err) {
      console.error('Error fetching students:', err);
    }
    
    const submittedCount = submissions.length > 0 ? new Set(submissions.map(s => s.userId)).size : 0;
    
    // Ensure shareableCode is included
    let shareableCode = assignment.shareableCode;
    if (!shareableCode && assignment.id) {
      // Generate a code if one doesn't exist
      shareableCode = generateShareableCode();
      try {
        // Try to update the assignment with the new code, but don't fail if it doesn't work
        await storage.updateAssignmentShareableCode(assignment.id, shareableCode);
      } catch (err) {
        console.error('Error updating assignment with shareable code:', err);
      }
    }
    
    res.json({
      ...assignment,
      course,
      submittedCount,
      totalStudents: students.length,
      submissionPercentage: students.length > 0 ? (submittedCount / students.length) * 100 : 0,
      shareableCode: shareableCode || 'temp-' + assignment.id
    });
  }));
  
  // Update assignment status (instructor only)
  app.patch('/api/assignments/:id/status', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
    const assignmentId = parseInt(req.params.id);
    
    if (isNaN(assignmentId)) {
      return res.status(400).json({ message: 'Invalid assignment ID' });
    }
    
    // Validate request
    const statusSchema = z.object({
      status: z.enum(['active', 'upcoming', 'completed'])
    });
    
    const result = statusSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid status value', errors: result.error });
    }
    
    const { status } = result.data;
    
    // Check if assignment exists
    const assignment = await storage.getAssignment(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    // Update assignment status
    const updatedAssignment = await storage.updateAssignmentStatus(assignmentId, status);
    
    res.json(updatedAssignment);
  }));

  // Lookup assignment by shareable code - with rate limiting
  app.get('/api/assignments/code/:code', defaultRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const code = req.params.code;
    
    console.log(`Looking up assignment with code: ${code}`);
    
    if (!code || code.length < 6) {
      console.log(`Invalid shareable code: ${code}`);
      return res.status(400).json({ message: 'Invalid shareable code' });
    }
    
    // Query assignments to find one with matching shareable code
    const assignments = await storage.listAssignments();
    console.log(`Found ${assignments.length} assignments total`);
    
    // Print all available shareable codes for debugging
    const allCodes = assignments
      .filter(a => a.shareableCode)
      .map(a => ({ id: a.id, code: a.shareableCode }));
    console.log(`Available shareable codes:`, JSON.stringify(allCodes));
    
    // Use case-insensitive comparison to find the assignment
    // This fixes issues where the code might be in a different case than stored
    const assignment = assignments.find(a => 
      a.shareableCode && a.shareableCode.toLowerCase() === code.toLowerCase());
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found with this code' });
    }
    
    // Get course information
    const course = await storage.getCourse(assignment.courseId);
    
    if (!course) {
      return res.status(404).json({ message: 'Course not found for this assignment' });
    }
    
    // Check if user is authenticated
    const isAuthenticated = req.isAuthenticated();
    
    // If user is not authenticated, they will be redirected to login
    // from the client side, and then back to the submission page
    
    // Ensure assignment has a valid shareable code
    let shareableCode = assignment.shareableCode;
    
    // If no shareable code exists, generate one and try to persist it
    if (!shareableCode && assignment.id) {
      shareableCode = generateShareableCode();
      try {
        // Try to update the assignment with the new code, but don't fail if it doesn't work
        await storage.updateAssignmentShareableCode(assignment.id, shareableCode);
        console.log(`Generated new shareable code ${shareableCode} for assignment ${assignment.id}`);
      } catch (err) {
        console.error('Error updating assignment with new shareable code:', err);
      }
    }

    // Return assignment with authentication status flag set to true (always require auth)
    res.json({
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      courseId: assignment.courseId,
      courseCode: course.code,
      courseName: course.name,
      dueDate: assignment.dueDate,
      // Always provide a shareable code, using temp- prefix as fallback if needed
      shareableCode: shareableCode || `TEMP-${assignment.id}`,
      requiresAuth: true, // Always require authentication for submissions
      isAuthenticated: isAuthenticated // Flag indicating if user is already authenticated
    });
  }));

  // Shareable link submission (requires authentication) - with strict rate limiting
  // The /api/anonymous-submissions endpoint is now deprecated but remains for backward compatibility
  // It now requires authentication and mirrors the main submissions endpoint
  app.post('/api/anonymous-submissions', submissionRateLimiter, requireAuth, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    const submissionSchema = z.object({
      assignmentId: z.string().transform(val => parseInt(val)),
      submissionType: z.enum(['file', 'code']),
      name: z.string().min(1),
      email: z.string().email(),
      notes: z.string().optional(),
      code: z.string().optional(),
      shareableCode: z.string().min(1, "Shareable code is required for link-based submissions"),
    });
    
    const result = submissionSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid submission data', errors: result.error });
    }
    
    const { assignmentId, submissionType, name, email, notes, code, shareableCode } = result.data;
    
    // Get the assignment to validate the shareableCode
    const assignment = await storage.getAssignment(assignmentId);
    
    // Check if assignment exists
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    // Validate shareable code - this is a critical security check
    let storedShareableCode = assignment.shareableCode;
    
    // If assignment has no shareable code but has an ID, generate and persist one
    if (!storedShareableCode && assignment.id) {
      storedShareableCode = generateShareableCode();
      try {
        await storage.updateAssignmentShareableCode(assignment.id, storedShareableCode);
        console.log(`Generated new shareable code ${storedShareableCode} for assignment ${assignment.id}`);
      } catch (err) {
        console.error('Error updating assignment with new shareable code:', err);
      }
    }
    
    // If no valid stored code, use temporary format based on ID for security
    if (!storedShareableCode) {
      storedShareableCode = `TEMP-${assignment.id}`;
    }
    
    // Now compare the provided code with the stored/generated one
    if (shareableCode !== storedShareableCode) {
      return res.status(403).json({ message: 'Invalid shareable code' });
    }
    
    const userId = req.user ? (req.user as any).id : 0;
    
    // Prepare submission data
    let submission: any = {
      assignmentId,
      userId,
      name,
      email,
      status: 'submitted',
      notes,
      contentType: null,
      fileSize: null,
      fileName: null,
      fileExtension: null,
      submissionType
    };
    
    // Handle submission content based on type
    if (submissionType === 'file') {
      // File upload - process file from multer
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      
      // Determine content type based on file extension and mime type
      const extension = path.extname(req.file.originalname).toLowerCase().slice(1);
      const mimeType = req.file.mimetype;
      const contentType = determineContentType(mimeType, req.file.originalname);
      
      if (!contentType || !isFileTypeAllowed(extension, contentType)) {
        return res.status(400).json({ 
          message: `File type .${extension} is not allowed`,
          allowedTypes: SUPPORTED_MIME_TYPES
        });
      }
      
      // Add file information to submission
      submission.contentType = contentType;
      submission.fileSize = req.file.size;
      submission.fileName = req.file.originalname;
      submission.fileExtension = extension;
      submission.content = req.file.buffer.toString('base64');
    } else if (submissionType === 'code') {
      // Code snippet submission
      if (!code) {
        return res.status(400).json({ message: 'Code content is required for code submissions' });
      }
      
      submission.contentType = 'text';
      submission.content = code;
      submission.fileExtension = 'txt';
    } else {
      return res.status(400).json({ message: 'Invalid submission type' });
    }
    
    // Create the submission in the database
    const createdSubmission = await storage.createSubmission(submission);
    
    // Add to processing queue
    await submissionQueue.add('process', {
      submissionId: createdSubmission.id,
      assignmentId: assignmentId,
      userId: userId,
      submissionType: submissionType,
      contentType: submission.contentType,
      content: submission.content,
      fileName: submission.fileName,
      fileExtension: submission.fileExtension,
    });
    
    // Return success response
    res.status(201).json({
      id: createdSubmission.id,
      message: 'Submission added successfully and queued for processing'
    });
  }));

  // Submission endpoints
  app.post('/api/submissions', requireAuth, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
      const user = req.user as any;
      
      if (user.role !== 'student') {
        return res.status(403).json({ message: 'Only students can submit assignments' });
      }
      
      // Validate request
      const submissionSchema = z.object({
        assignmentId: z.string().transform(val => parseInt(val)),
        submissionType: z.enum(['file', 'code']),
        notes: z.string().optional()
      });
      
      const result = submissionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: 'Invalid submission data', errors: result.error });
      }
      
      const { assignmentId, submissionType, notes } = result.data;
      
      // Check if assignment exists and is active
      const isActive = await storageService.isAssignmentActive(assignmentId);
      if (!isActive) {
        return res.status(400).json({ message: 'Assignment is not active or has passed its due date' });
      }
      
      // Check if student is enrolled in the course
      const isEnrolled = await storageService.isStudentEnrolled(user.id, assignmentId);
      if (!isEnrolled) {
        return res.status(403).json({ message: 'You are not enrolled in this course' });
      }
      
      // Create submission
      let fileUrl = '';
      let fileName = '';
      let content = '';
      let mimeType = null;
      let fileSize = null;
      let contentType: ContentType | null = null;
      
      if (submissionType === 'file' && req.file) {
        // Get file metadata
        fileName = req.file.originalname;
        mimeType = req.file.mimetype;
        fileSize = req.file.size;
        
        // Determine content type based on file extension and MIME type
        const fileExtension = path.extname(fileName).slice(1).toLowerCase();
        contentType = determineContentType(mimeType, fileName);
        
        console.log(`User ${user.id} submission: ${fileName}, MIME: ${mimeType}, Content type: ${contentType}`);
        
        // Verify that the file type is allowed by passing the determined content type
        // This ensures we're checking based on content category rather than exact MIME/extension match
        const isAllowed = await storage.checkFileTypeEnabled(contentType, fileExtension, mimeType);
        if (!isAllowed) {
          return res.status(400).json({ 
            message: `File type ${fileExtension} (${mimeType}) is not allowed`,
            details: 'This file type is currently not supported for AI evaluation'
          });
        }
        
        // Store file and get URL
        fileUrl = await storageService.storeSubmissionFile(req.file, user.id, assignmentId);
        
        // For text files, extract and store content
        if (contentType === 'text' && mimeType.startsWith('text/')) {
          content = req.file.buffer.toString('utf8');
        }
      } else if (submissionType === 'code') {
        // Get code from request body
        content = req.body.code || '';
        
        if (!content.trim()) {
          return res.status(400).json({ message: 'Code content is required for code submissions' });
        }
        
        // Set default metadata for code submissions
        mimeType = 'text/plain';
        contentType = 'text' as ContentType;
        fileSize = Buffer.from(content).length;
      } else {
        return res.status(400).json({ message: 'Invalid submission type or missing file' });
      }
      
      // Create submission in database with additional metadata for multimodal content
      const submission = await storage.createSubmission({
        assignmentId,
        userId: user.id,
        fileUrl,
        fileName,
        content,
        notes: notes || null,
        status: 'pending',
        mimeType: mimeType || null,
        fileSize: fileSize || null,
        contentType: contentType || null
      });
      
      // Queue submission for AI processing
      submissionQueue.addSubmission(submission.id);
      
      res.status(201).json(submission);
  }));

  // Get submissions for the current user
  app.get('/api/submissions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const user = req.user as any;
      const assignmentId = req.query.assignmentId ? parseInt(req.query.assignmentId as string) : undefined;
      
      // Get submissions
      const submissions = await storage.listSubmissionsForUser(user.id, assignmentId);
      
      // For each submission, get the feedback
      const submissionsWithFeedback = await Promise.all(
        submissions.map(async (submission) => {
          const feedbackItem = await storage.getFeedbackBySubmissionId(submission.id);
          return {
            ...submission,
            feedback: feedbackItem
          };
        })
      );
      
      res.json(submissionsWithFeedback);
  }));

  // Get recent submissions for the current user
  app.get('/api/submissions/recent', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const user = req.user as any;
      
      // Get recent submissions using the storage service instead of direct db access
      const userSubmissions = await storage.listSubmissionsForUser(user.id);
      
      // Sort by created date (descending) and take only 5
      const recentSubmissions = userSubmissions
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);
      
      // For each submission, get the feedback
      const submissionsWithFeedback = await Promise.all(
        recentSubmissions.map(async (submission) => {
          const feedbackItem = await storage.getFeedbackBySubmissionId(submission.id);
          
          return {
            ...submission,
            feedback: feedbackItem
          };
        })
      );
      
      res.json(submissionsWithFeedback);
  }));

  // Get submissions for a specific assignment (instructor only)
  app.get('/api/assignments/:id/submissions', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      const assignmentId = parseInt(req.params.id);
      
      // Check if assignment exists
      const assignment = await storage.getAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
      
      const submissions = await storage.listSubmissionsForAssignment(assignmentId);
      
      // For each submission, get the feedback
      const submissionsWithFeedback = await Promise.all(
        submissions.map(async (submission) => {
          const feedback = await storage.getFeedbackBySubmissionId(submission.id);
          
          return {
            ...submission,
            feedback
          };
        })
      );
      
      res.json(submissionsWithFeedback);
  }));

  // Course endpoints
  app.get('/api/courses', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const user = req.user as any;
      let courses;
      
      if (user.role === 'instructor') {
        // Instructors can see all courses
        courses = await storage.listCourses();
        
        // Enhance courses with additional stats
        courses = await Promise.all(courses.map(async (course: any) => {
          // Get assignments for this course
          const courseAssignments = await storage.listAssignments(course.id);
          
          // Get enrollment count
          const enrolledStudents = await storage.listCourseEnrollments(course.id);
          
          return {
            ...course,
            assignmentCount: courseAssignments.length,
            studentCount: enrolledStudents.length
          };
        }));
      } else {
        // Students can only see courses they're enrolled in
        courses = await storage.listUserEnrollments(user.id);
      }
      
      res.json(courses);
  }));
  
  // Get course by ID with its assignments
  app.get('/api/courses/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const courseId = parseInt(req.params.id);
      
      if (isNaN(courseId)) {
        return res.status(400).json({ message: 'Invalid course ID' });
      }
      
      // Get the course
      const course = await storage.getCourse(courseId);
      
      if (!course) {
        return res.status(404).json({ message: 'Course not found' });
      }
      
      // Get assignments for this course
      const assignments = await storage.listAssignments(courseId);
      
      // Get enrollment count
      const enrolledStudents = await storage.listCourseEnrollments(courseId);
      const studentCount = enrolledStudents.length;
      
      // Get submission counts for each assignment
      const assignmentsWithStats = await Promise.all(
        assignments.map(async (assignment) => {
          const submissions = await storage.listSubmissionsForAssignment(assignment.id);
          const submittedCount = new Set(submissions.map(s => s.userId)).size;
          
          return {
            ...assignment,
            submittedCount,
            totalStudents: studentCount,
            submissionPercentage: studentCount > 0 ? (submittedCount / studentCount) * 100 : 0
          };
        })
      );
      
      // Return course with assignments and stats
      res.json({
        ...course,
        studentCount,
        assignments: assignmentsWithStats
      });
  }));
  
  // Create course (instructor only)
  app.post('/api/courses', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      const { name, code, description } = req.body;
      
      // Validate request
      const courseSchema = z.object({
        name: z.string().min(3),
        code: z.string().min(2),
        description: z.string().optional()
      });
      
      const result = courseSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: 'Invalid course data', errors: result.error });
      }
      
      // Check if course code already exists
      const existingCourse = await storage.getCourseByCode(code);
      if (existingCourse) {
        return res.status(400).json({ message: 'Course code already exists' });
      }
      
      // Create course
      const course = await storage.createCourse({
        name,
        code,
        description: description || null
      });
      
      // Automatically enroll the test student in this course
      // This ensures the instructor can test student interactions
      const testStudent = await storage.getUserByEmail('student@test.com');
      if (testStudent) {
        await storage.createEnrollment({
          userId: testStudent.id,
          courseId: course.id
        });
        console.log(`Automatically enrolled test student (ID: ${testStudent.id}) in course ${course.name}`);
      }
      
      res.status(201).json(course);
  }));

  // Student progress data for instructors
  app.get('/api/students/progress/:assignmentId?', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      // Set default values
      let page = 1;
      const pageSize = 10;
      const searchQuery = req.query.search as string || '';
      const statusFilter = req.query.status as string || 'all';
      
      // Safely parse page parameter
      if (req.query.page) {
        const parsedPage = parseInt(req.query.page as string, 10);
        if (!isNaN(parsedPage) && parsedPage > 0) {
          page = parsedPage;
        }
      }
      
      // Safely parse assignmentId parameter
      let assignmentId: number | undefined = undefined;
      if (req.params.assignmentId) {
        const parsedId = parseInt(req.params.assignmentId, 10);
        if (!isNaN(parsedId) && parsedId > 0) {
          assignmentId = parsedId;
        } else {
          console.warn(`Invalid assignmentId format: ${req.params.assignmentId}`);
        }
      }
      
      let students;
      let totalCount;
      
      if (assignmentId) {
        // Get assignment
        const assignment = await storage.getAssignment(assignmentId);
        if (!assignment) {
          return res.status(404).json({ message: 'Assignment not found' });
        }
        
        // Get all students enrolled in the course
        const enrolledStudents = await storage.listCourseEnrollments(assignment.courseId);
        
        // Get submissions for this assignment
        const submissions = await storage.listSubmissionsForAssignment(assignmentId);
        
        // Group submissions by student
        const submissionsByStudent = submissions.reduce((acc, submission) => {
          if (!acc[submission.userId]) {
            acc[submission.userId] = [];
          }
          acc[submission.userId].push(submission);
          return acc;
        }, {} as Record<number, any[]>);
        
        // Map students to progress data
        students = enrolledStudents.map(student => {
          const studentSubmissions = submissionsByStudent[student.id] || [];
          const latestSubmission = studentSubmissions.length > 0 ? 
            studentSubmissions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] : 
            null;
          
          let status: 'submitted' | 'not_submitted' | 'needs_review' = 'not_submitted';
          
          if (latestSubmission) {
            if (latestSubmission.status === 'completed') {
              status = 'submitted';
            } else if (['pending', 'processing'].includes(latestSubmission.status)) {
              status = 'needs_review';
            }
          }
          
          return {
            id: student.id,
            name: student.name,
            email: student.email,
            status,
            lastSubmission: latestSubmission ? new Date(latestSubmission.createdAt).toLocaleString() : undefined,
            attempts: studentSubmissions.length,
            submissionId: latestSubmission ? latestSubmission.id : undefined
          };
        });
        
        totalCount = students.length;
      } else {
        // Get all students for pagination
        const allStudents = await db.select().from(users).where(eq(users.role, 'student'));
        totalCount = allStudents.length;
        
        // Get paginated students
        // Get all submissions to determine status
        const allSubmissions = await db.select().from(submissions);
        
        students = allStudents.slice((page - 1) * pageSize, page * pageSize).map((student: User) => {
          // Find the most recent submission for this student
          const studentSubmissions = allSubmissions.filter((sub: any) => sub.userId === student.id);
          const latestSubmission = studentSubmissions.length > 0 ? 
            studentSubmissions.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] : 
            null;
            
          let status: 'submitted' | 'not_submitted' | 'needs_review' = 'not_submitted';
          
          if (latestSubmission) {
            if (latestSubmission.status === 'completed') {
              status = 'submitted';
            } else if (['pending', 'processing'].includes(latestSubmission.status)) {
              status = 'needs_review';
            }
          }
          
          return {
            id: student.id,
            name: student.name,
            email: student.email,
            status,
            lastSubmission: latestSubmission ? new Date(latestSubmission.createdAt).toLocaleString() : undefined,
            attempts: studentSubmissions.length,
            submissionId: latestSubmission ? latestSubmission.id : undefined
          };
        });
      }
      
      // Apply search filter
      if (searchQuery) {
        students = students.filter((student: { name: string; email: string }) => 
          student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          student.email.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      
      // Apply status filter
      if (statusFilter !== 'all') {
        students = students.filter((student: { status: string }) => student.status === statusFilter);
      }
      
      // Calculate pagination
      const filteredCount = students.length;
      const totalPages = Math.ceil(filteredCount / pageSize);
      
      // Paginate results
      const paginatedStudents = students.slice((page - 1) * pageSize, page * pageSize);
      
      res.json({
        students: paginatedStudents,
        totalCount: filteredCount,
        totalPages,
        currentPage: page
      });
  }));

  // Import count from drizzle-orm if it's not available in the current scope
  const { count: countFn } = await import('drizzle-orm');

  // Assignment statistics for instructors
  app.get('/api/assignments/stats', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      // Wrap everything in a try-catch for better error handling
      try {
      // Extract and validate course/assignment IDs from query params
      let courseId: number | undefined = undefined;
      let assignmentId: number | undefined = undefined;
      
      console.log("Stats query params:", req.query);
      
      try {
        // Safely parse courseId - strict validation and conversion
        if (req.query.courseId && 
            typeof req.query.courseId === 'string' && 
            req.query.courseId !== 'undefined' && 
            req.query.courseId !== 'null') {
            
          // Only proceed if it's a valid positive integer
          const parsedCourseId = parseInt(req.query.courseId, 10);
          if (!isNaN(parsedCourseId) && parsedCourseId > 0) {
            courseId = parsedCourseId;
            console.log("Using courseId:", courseId);
          } else {
            console.warn("Invalid courseId format:", req.query.courseId);
          }
        }
        
        // Safely parse assignmentId - strict validation and conversion
        if (req.query.assignmentId && 
            typeof req.query.assignmentId === 'string' && 
            req.query.assignmentId !== 'undefined' && 
            req.query.assignmentId !== 'null') {
            
          // Only proceed if it's a valid positive integer
          const parsedAssignmentId = parseInt(req.query.assignmentId, 10);
          if (!isNaN(parsedAssignmentId) && parsedAssignmentId > 0) {
            assignmentId = parsedAssignmentId;
            console.log("Using assignmentId:", assignmentId);
          } else {
            console.warn("Invalid assignmentId format:", req.query.assignmentId);
          }
        }
      } catch (e) {
        console.warn('Error parsing course/assignment IDs:', e);
        // Continue with undefined IDs if parsing fails
      }
      
      // Get all assignments (filtered by course if specified)
      let allAssignments = await storage.listAssignments();
      console.log(`Total assignments before filtering: ${allAssignments.length}`);
      
      if (courseId) {
        allAssignments = allAssignments.filter(a => a.courseId === courseId);
        console.log(`Assignments after filtering by courseId ${courseId}: ${allAssignments.length}`);
      }
      
      // Get target assignment if specified
      let targetAssignment = undefined;
      if (assignmentId) {
        try {
          // Extra precaution - ensure assignmentId is a valid positive integer
          if (typeof assignmentId === 'number' && !isNaN(assignmentId) && assignmentId > 0 && Number.isInteger(assignmentId)) {
            console.log(`Attempting to fetch assignment with ID: ${assignmentId} (type: ${typeof assignmentId})`);
            targetAssignment = await storage.getAssignment(assignmentId);
            console.log("Target assignment found:", targetAssignment ? "Yes" : "No");
            
            // If assignmentId was provided but no assignment was found, return appropriate response
            if (!targetAssignment) {
              console.warn(`Assignment with ID ${assignmentId} not found - returning default stats`);
              return res.json({
                totalStudents: 0,
                submittedCount: 0,
                notStartedCount: 0,
                submissionRate: 0,
                totalSubmissions: 0,
                pendingReviews: 0,
                averageScore: 0,
                feedbackGenerated: 0,
                feedbackViewed: 0,
                feedbackViewRate: 0,
                submissionsIncrease: 0,
                scoreDistribution: { high: 0, medium: 0, low: 0 },
                feedbackViewLast30Days: Array(30).fill(0),
                submissionsLast30Days: Array(30).fill(0),
                notStartedPercentage: 0,
                submittedPercentage: 0,
                feedbackViewPercentage: 0
              });
            }
          } else {
            console.error(`Invalid assignmentId detected: ${assignmentId}, type: ${typeof assignmentId}`);
            // Don't return 404 for invalid assignment format, just continue with general stats
          }
        } catch (error) {
          console.error("Error fetching target assignment:", error);
          // Continue without the target assignment
        }
      }
      
      // Get all submissions (filtered by assignment if specified)
      let submissionsQuery = await db.select().from(submissions);
      
      try {
        if (assignmentId && typeof assignmentId === 'number' && !isNaN(assignmentId)) {
          console.log(`Filtering submissions by assignmentId: ${assignmentId}`);
          submissionsQuery = submissionsQuery.filter((s: any) => {
            return s && s.assignmentId === assignmentId;
          });
          console.log(`Found ${submissionsQuery.length} submissions for assignment ID ${assignmentId}`);
        } else if (courseId && typeof courseId === 'number' && !isNaN(courseId)) {
          // Filter submissions by course (need to join with assignments)
          const assignmentIds = allAssignments.map(a => a.id);
          console.log(`Filtering submissions by course-related assignments: [${assignmentIds.join(', ')}]`);
          
          submissionsQuery = submissionsQuery.filter((s: any) => {
            return s && s.assignmentId && assignmentIds.includes(s.assignmentId);
          });
          console.log(`Found ${submissionsQuery.length} submissions for course ID ${courseId}`);
        } else {
          console.log(`No filtering applied to submissions. Total: ${submissionsQuery.length}`);
        }
      } catch (error) {
        console.error("Error while filtering submissions:", error);
      }
      
      // Get enrolled students (for the selected course or all courses)
      let totalStudents = 0;
      if (courseId) {
        const students = await storage.listCourseEnrollments(courseId);
        totalStudents = students.length;
        console.log(`Students enrolled in course ${courseId}: ${totalStudents}`);
      } else {
        try {
          // Count all students
          const studentCount = await db.select({ count: countFn() })
            .from(users)
            .where(eq(users.role, 'student'));
          
          console.log("Raw student count result:", studentCount);
          
          // Handle various formats that countFn might return
          if (studentCount && studentCount.length > 0) {
            if (typeof studentCount[0].count === 'number') {
              totalStudents = studentCount[0].count;
            } else if (typeof studentCount[0].count === 'string') {
              // If count comes back as string, parse it safely
              const parsedCount = parseInt(studentCount[0].count, 10);
              totalStudents = !isNaN(parsedCount) ? parsedCount : 0;
            } else if (studentCount[0].count !== null && studentCount[0].count !== undefined) {
              // Handle other non-null cases
              totalStudents = Number(studentCount[0].count) || 0;
            }
          }
          
          // Ensure we always have a valid number
          if (isNaN(totalStudents)) totalStudents = 0;
          
          console.log(`Total students in system: ${totalStudents}`);
        } catch (error) {
          console.error("Error counting students:", error);
          totalStudents = 0;
        }
      }
      
      // Calculate submission metrics with detailed logging
      const totalSubmissions = submissionsQuery.length;
      console.log(`Total submissions found: ${totalSubmissions}`);
      
      // Count unique students who have submitted
      const submittedStudentIds = new Set();
      submissionsQuery.forEach((s: any) => {
        if (s && s.userId) submittedStudentIds.add(s.userId);
      });
      const submittedCount = submittedStudentIds.size;
      console.log(`Number of unique students who submitted: ${submittedCount}`);
      
      // Calculate students who haven't submitted
      const notStartedCount = Math.max(0, totalStudents - submittedCount);
      console.log(`Students who haven't started: ${notStartedCount}`);
      
      // Calculate submission rates
      const submissionRate = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;
      
      // Filter submissions to get those that need review
      const pendingReviews = submissionsQuery.filter(
        (s: { status: string }) => s.status === 'completed' 
      ).length;
      
      // Calculate average score (if available in feedback)
      let feedbackItems = await db.select().from(feedback);
      if (assignmentId) {
        // Filter feedback for specific assignment
        const submissionIds = submissionsQuery.map((s: any) => s.id);
        feedbackItems = feedbackItems.filter((f: any) => submissionIds.includes(f.submissionId));
      }
      
      // Extract and validate scores with extensive error handling
      const scores: number[] = [];
      for (const item of feedbackItems) {
        // Check if score exists and is a number or can be converted to one
        if (item.score !== null && item.score !== undefined) {
          const numericScore = Number(item.score);
          // Only add valid scores (not NaN) that are within reasonable range (0-100)
          if (!isNaN(numericScore) && numericScore >= 0 && numericScore <= 100) {
            scores.push(numericScore);
          } else {
            console.warn(`Invalid score found in feedback: ${item.score}, converted to: ${numericScore}`);
          }
        }
      }
      
      // Safely calculate average score with bounds checking
      let averageScore = 0;
      if (scores.length > 0) {
        try {
          const sum = scores.reduce((a, b) => {
            // Additional safety check in reducer
            if (typeof a !== 'number' || typeof b !== 'number' || isNaN(a) || isNaN(b)) {
              console.warn(`Invalid values in score reduction: a=${a}, b=${b}`);
              return 0; // Reset to avoid NaN propagation
            }
            return a + b;
          }, 0);
          
          averageScore = Math.round(sum / scores.length);
          
          // Final sanity check
          if (isNaN(averageScore) || averageScore < 0 || averageScore > 100) {
            console.warn(`Calculated average score out of bounds: ${averageScore}, resetting to 0`);
            averageScore = 0;
          }
        } catch (error) {
          console.error("Error calculating average score:", error);
          averageScore = 0;
        }
      }
      
      // Calculate score distribution
      let scoreDistribution = { high: 0, medium: 0, low: 0 };
      try {
        if (scores.length > 0) {
          // Count scores in each category
          for (const score of scores) {
            if (score >= 80) {
              scoreDistribution.high++;
            } else if (score >= 50) {
              scoreDistribution.medium++;
            } else {
              scoreDistribution.low++;
            }
          }
          console.log("Score distribution calculated:", scoreDistribution);
        }
      } catch (error) {
        console.error("Error calculating score distribution:", error);
        scoreDistribution = { high: 0, medium: 0, low: 0 };
      }
      
      // Calculate feedback generation and viewed stats
      const feedbackGenerated = feedbackItems.length;
      const feedbackViewed = feedbackItems.filter((f: any) => f.viewed).length;
      const feedbackViewRate = feedbackGenerated > 0 ? Math.round((feedbackViewed / feedbackGenerated) * 100) : 0;
      
      // Calculate submission increase (over last week)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const submissionsLastWeek = submissionsQuery.filter(
        (s: { createdAt: string | Date }) => new Date(s.createdAt) >= oneWeekAgo
      ).length;
      
      const previousWeekStart = new Date(oneWeekAgo);
      previousWeekStart.setDate(previousWeekStart.getDate() - 7);
      
      const submissionsPreviousWeek = submissionsQuery.filter(
        (s: { createdAt: string | Date }) => new Date(s.createdAt) >= previousWeekStart && new Date(s.createdAt) < oneWeekAgo
      ).length;
      
      const submissionsIncrease = submissionsPreviousWeek > 0
        ? Math.round((submissionsLastWeek - submissionsPreviousWeek) / submissionsPreviousWeek * 100)
        : 0;
      
      // Return complete statistics object
      res.json({
        totalStudents,
        submittedCount,
        notStartedCount,
        submissionRate,
        totalSubmissions,
        pendingReviews,
        averageScore,
        feedbackGenerated,
        feedbackViewed,
        feedbackViewRate,
        submissionsIncrease,
        scoreDistribution, // Add the score distribution object
        // Include submission percentages for dashboard display
        submittedPercentage: submissionRate,
        notStartedPercentage: totalStudents > 0 ? Math.round((notStartedCount / totalStudents) * 100) : 0,
        feedbackViewPercentage: feedbackViewRate
      });
      } catch (error) {
        console.error("Error in /api/assignments/stats:", error);
        // Return default values if there's an error
        return res.json({
          totalStudents: 0,
          submittedCount: 0,
          notStartedCount: 0,
          submissionRate: 0,
          totalSubmissions: 0,
          pendingReviews: 0,
          averageScore: 0,
          feedbackGenerated: 0,
          feedbackViewed: 0,
          feedbackViewRate: 0,
          submissionsIncrease: 0,
          scoreDistribution: { high: 0, medium: 0, low: 0 },
          feedbackViewLast30Days: Array(30).fill(0),
          submissionsLast30Days: Array(30).fill(0),
          notStartedPercentage: 0,
          submittedPercentage: 0,
          feedbackViewPercentage: 0
        });
      }
  }));

  // Assignment analytics for instructors
  app.get('/api/assignments/:id?/analytics', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      // Safely parse the assignment ID
      let assignmentId: number | undefined = undefined;
      if (req.params.id) {
        const parsed = parseInt(req.params.id, 10);
        if (!isNaN(parsed) && parsed > 0) {
          assignmentId = parsed;
        } else {
          console.warn("Invalid assignment ID format:", req.params.id);
        }
      }
      
      let targetAssignmentId = assignmentId;
      
      // If no specific assignment, get the most recent active assignment
      if (!targetAssignmentId) {
        const activeAssignments = (await storage.listAssignments())
          .filter(a => a.status === 'active')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        if (activeAssignments.length === 0) {
          return res.status(404).json({ message: 'No active assignments found' });
        }
        
        targetAssignmentId = activeAssignments[0].id;
      }
      
      // Get assignment
      const assignment = await storage.getAssignment(targetAssignmentId);
      if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
      
      // Get submissions for this assignment
      const submissions = await storage.listSubmissionsForAssignment(targetAssignmentId);
      
      // Get enrolled students
      const students = await storage.listCourseEnrollments(assignment.courseId);
      const totalStudents = students.length;
      
      // Calculate submitted students (unique)
      const submittedStudentIds = new Set(submissions.map(s => s.userId));
      const submittedCount = submittedStudentIds.size;
      
      // Calculate students who started but haven't finished
      // (have at least one submission but latest is not completed)
      const inProgressStudents = new Map();
      
      for (const submission of submissions) {
        if (!inProgressStudents.has(submission.userId) || 
            new Date(submission.createdAt) > new Date(inProgressStudents.get(submission.userId).createdAt)) {
          inProgressStudents.set(submission.userId, submission);
        }
      }
      
      const inProgressCount = Array.from(inProgressStudents.values()).filter(
        s => s.status === 'pending' || s.status === 'processing'
      ).length;
      
      // Calculate students who haven't started
      const notStartedCount = totalStudents - submittedCount;
      
      // Create timeline data (submissions per day for the last week)
      const timeline = [];
      const today = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const count = submissions.filter(
          s => new Date(s.createdAt) >= date && new Date(s.createdAt) < nextDate
        ).length;
        
        timeline.push({
          date: date.toISOString().split('T')[0],
          count
        });
      }
      
      // Calculate average feedback metrics
      const feedbackItems = await Promise.all(
        submissions.map(s => storage.getFeedbackBySubmissionId(s.id))
      );
      
      const validFeedback = feedbackItems.filter(f => f !== undefined) as any[];
      
      const avgFeedbackTime = validFeedback.length > 0
        ? Math.round(validFeedback.reduce((sum, f) => sum + f.processingTime, 0) / validFeedback.length / 1000)
        : 0;
      
      // Average revisions per student
      const submissionsByStudent = submissions.reduce((acc, sub) => {
        if (!acc[sub.userId]) acc[sub.userId] = [];
        acc[sub.userId].push(sub);
        return acc;
      }, {} as Record<number, any[]>);
      
      const revisionsPerStudent = Object.values(submissionsByStudent)
        .map(subs => subs.length);
      
      const avgRevisionsPerStudent = revisionsPerStudent.length > 0
        ? revisionsPerStudent.reduce((sum, count) => sum + count, 0) / revisionsPerStudent.length
        : 0;
      
      // Mock improvement percentage for now
      // In a real app, this would compare scores between first and last submissions
      const avgImprovementPercentage = 18;
      
      res.json({
        assignmentStats: {
          submittedCount,
          inProgressCount,
          notStartedCount,
          totalCount: totalStudents,
          submissionPercentage: totalStudents > 0 ? (submittedCount / totalStudents) * 100 : 0
        },
        submissionTimeline: timeline,
        avgFeedbackTime,
        avgRevisionsPerStudent,
        avgImprovementPercentage
      });
  }));

// Test rubric with AI (instructor only)
  app.post('/api/test-rubric', requireAuth, requireRole('instructor'), 
    // Use multer middleware to handle file uploads
    upload.single('file'),
    asyncHandler(async (req: Request, res: Response) => {
      let content = req.body.content;
      const { assignmentContext } = req.body;
      let file = req.file;
      
      // Check if we have either content or a file
      if (!content && !file) {
        return res.status(400).json({ message: 'Content or file is required' });
      }
      
      // Use AI service to analyze the content - always use GeminiAdapter since we have that key
      const aiService = new AIService(new GeminiAdapter());
      
      try {
        let feedback;
        
        if (file) {
          // Handle image and binary file types differently
          const isImage = file.mimetype.startsWith('image/');
          const isDocument = file.mimetype.includes('pdf') || 
                           file.mimetype.includes('word') || 
                           file.mimetype.includes('doc');
          
          if (isImage) {
            // For images, we use multimodal analysis
            console.log(`Processing image file: ${file.originalname} (${file.mimetype}), buffer size: ${file.buffer.length} bytes`);
            
            try {
              // Convert buffer to data URI for small images (under 5MB) to avoid file path issues
              const isSmallImage = file.buffer.length < 5 * 1024 * 1024;
              const imageDataUri = isSmallImage 
                ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
                : undefined;
                
              console.log(`Using ${isSmallImage ? 'data URI' : 'buffer'} for image processing`);
              
              feedback = await aiService.analyzeMultimodalSubmission({
                fileBuffer: file.buffer,
                fileDataUri: imageDataUri, // Add data URI for small images
                fileName: file.originalname,
                mimeType: file.mimetype,
                assignmentTitle: "Image Analysis",
                assignmentDescription: assignmentContext || "Please analyze this image submission."
              });
            } catch (error: any) {
              console.error(`Error analyzing image: ${error.message || 'Unknown error'}`, error);
              return res.status(500).json({
                error: "Failed to analyze image",
                message: error.message || 'Unknown error',
                strengths: ["We encountered an error analyzing your image."],
                improvements: ["Please try a different image or a text submission."],
                suggestions: ["Make sure your image is a standard format (JPEG, PNG, etc)."],
                summary: "There was an error processing your image submission. For best results, try using a standard image format under 5MB."
              });
            }
          } else if (isDocument) {
            // For documents, we use the document handling API
            console.log(`Processing document file: ${file.originalname} (${file.mimetype}), buffer size: ${file.buffer.length} bytes`);
            
            try {
              feedback = await aiService.analyzeMultimodalSubmission({
                fileBuffer: file.buffer, // Use buffer instead of path since we're using memoryStorage
                fileName: file.originalname,
                mimeType: file.mimetype,
                assignmentTitle: "Document Analysis",
                assignmentDescription: assignmentContext || "Please analyze this document submission."
              });
            } catch (error: any) {
              console.error(`Error analyzing document: ${error.message || 'Unknown error'}`, error);
              return res.status(500).json({
                error: "Failed to analyze document",
                message: error.message || 'Unknown error',
                strengths: ["We encountered an error analyzing your document."],
                improvements: ["Please try a different document format or a text submission."],
                suggestions: ["Make sure your document is a standard format (PDF, DOCX, etc)."],
                summary: "There was an error processing your document. For best results, try using a standard document format like PDF or DOCX under 5MB."
              });
            }
          } else {
            // For other files (text, code, etc.), read the file if we don't have content
            if (!content) {
              content = fs.readFileSync(file.path, 'utf8');
            }
            
            feedback = await aiService.analyzeProgrammingAssignment({
              content,
              assignmentContext
            });
          }
        } else {
          // Text-only submission
          feedback = await aiService.analyzeProgrammingAssignment({
            content,
            assignmentContext
          });
        }
        
        console.log("AI feedback generated successfully:", JSON.stringify(feedback).slice(0, 200) + "...");
        
        // Clean up the temporary file if it exists
        if (file && file.path) {
          fs.unlink(file.path, (err: NodeJS.ErrnoException | null) => {
            if (err) console.error("Error removing temporary file:", err);
          });
        }
        
        return res.json({
          strengths: feedback.strengths,
          improvements: feedback.improvements,
          suggestions: feedback.suggestions,
          summary: feedback.summary,
          score: feedback.score
        });
      } catch (error) {
        console.error("Error generating AI feedback:", error);
        
        // Clean up the temporary file if it exists
        if (file && file.path) {
          fs.unlink(file.path, (err: NodeJS.ErrnoException | null) => {
            if (err) console.error("Error removing temporary file:", err);
          });
        }
        
        return res.status(500).json({ 
          message: 'Failed to generate AI feedback',
          error: error instanceof Error ? error.message : String(error)
        });
      }
  }));

  // Export grades as CSV
  app.get('/api/export/grades', requireAuth, requireRole('instructor'), asyncHandler(async (req: Request, res: Response) => {
      const assignmentId = parseInt(req.query.assignmentId as string);
      
      if (!assignmentId) {
        return res.status(400).json({ message: 'Assignment ID is required' });
      }
      
      // Get assignment
      const assignment = await storage.getAssignment(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
      
      // Get course
      const course = await storage.getCourse(assignment.courseId);
      if (!course) {
        return res.status(404).json({ message: 'Course not found' });
      }
      
      // Get all enrolled students
      const students = await storage.listCourseEnrollments(assignment.courseId);
      
      // Get all submissions for this assignment
      const submissions = await storage.listSubmissionsForAssignment(assignmentId);
      
      // Group submissions by student
      const submissionsByStudent = submissions.reduce((acc, sub) => {
        if (!acc[sub.userId]) acc[sub.userId] = [];
        acc[sub.userId].push(sub);
        return acc;
      }, {} as Record<number, any[]>);
      
      // Get all feedback
      const feedbackPromises = submissions.map(s => storage.getFeedbackBySubmissionId(s.id));
      const allFeedback = await Promise.all(feedbackPromises);
      
      // Create a map of submission ID to feedback
      const feedbackBySubmission = new Map();
      allFeedback.filter(Boolean).forEach(f => {
        if (f) {
          feedbackBySubmission.set(f.submissionId, f);
        }
      });
      
      // Generate CSV data
      let csv = 'Student ID,Student Name,Student Email,Submission Status,Submission Date,Last Score,Attempts,Feedback Summary\n';
      
      for (const student of students) {
        const studentSubmissions = submissionsByStudent[student.id] || [];
        
        // Sort submissions by date (newest first)
        studentSubmissions.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        const latestSubmission = studentSubmissions[0];
        
        let status = 'Not Submitted';
        let submissionDate = '';
        let score = '';
        let attempts = studentSubmissions.length.toString();
        let feedbackSummary = '';
        
        if (latestSubmission) {
          status = latestSubmission.status === 'completed' ? 'Completed' : 
                   latestSubmission.status === 'processing' ? 'Processing' : 
                   latestSubmission.status === 'pending' ? 'Pending' : 'Failed';
          
          submissionDate = new Date(latestSubmission.createdAt).toLocaleString();
          
          const feedbackForLatest = feedbackBySubmission.get(latestSubmission.id);
          if (feedbackForLatest) {
            score = feedbackForLatest.score !== null ? feedbackForLatest.score.toString() : '';
            feedbackSummary = feedbackForLatest.summary.replace(/"/g, '""'); // Escape quotes for CSV
          }
        }
        
        csv += `${student.id},"${student.name}","${student.email}","${status}","${submissionDate}","${score}","${attempts}","${feedbackSummary}"\n`;
      }
      
      // Set content type and headers for download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${course.code}_${assignment.title.replace(/\s+/g, '_')}_grades.csv"`);
      
      res.send(csv);
  }));
  
  const httpServer = createServer(app);

  return httpServer;
}
