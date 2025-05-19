import { storage } from '../storage';
import { submissions, feedback, users, courses, assignments, enrollments } from '@shared/schema';
import { db } from '../db';
import { eq, and, lt, desc, sql, count, inArray } from 'drizzle-orm';
import { stringify } from 'csv-stringify';
import type { InferSelectModel } from 'drizzle-orm';

/**
 * Type definitions for batch operations
 */
interface Student {
  id: number;
  userId: number;
  name: string;
  email: string;
}

interface SubmissionRecord {
  userId: number;
  assignmentId: number;
  submissionId: number;
}

/**
 * Service for efficiently handling batch operations on large datasets
 * These operations are optimized for handling classes with thousands of students
 */
export class BatchOperationsService {
  // Maximum number of records to process in a single batch
  private batchSize = 1000;
  
  /**
   * Get comprehensive progress data for all students in a course
   * This implementation is optimized for large classes with thousands of students
   * @param courseId The course ID to get progress for
   */
  async getUserProgressForCourse(courseId: number): Promise<{
    courseId: number;
    courseName: string;
    totalStudents: number;
    totalAssignments: number;
    avgCompletionRate: number;
    avgScore: number;
    assignments: Array<{
      id: number;
      title: string;
      description: string | null;
      courseId: number;
      dueDate: Date;
      status: string;
      shareableCode: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    students: Array<{
      userId: number;
      name: string;
      email: string;
      completionRate: number;
      averageScore: number;
      completedAssignments: number;
      totalAssignments: number;
      submissions: Array<{
        id: number;
        userId: number;
        assignmentId: number;
        status: string;
        createdAt: Date;
        feedback: {
          id: number;
          submissionId: number;
          score: number | null;
          strengths: string[];
          improvements: string[];
          suggestions: string[];
          summary: string | null;
          criteriaScores: Array<{
            criteriaId: string;
            score: number;
            feedback: string;
          }> | null;
          processingTime: number;
          modelName: string | null;
          tokenCount: number | null;
          createdAt: Date;
        } | null;
      }>;
    }>;
  }> {
    // Get course information
    const course = await storage.getCourse(courseId);
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }
    
    // Get all assignments for this course
    const courseAssignments = await db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, courseId))
      .orderBy(assignments.dueDate);
    
    // Get all enrollments for this course with student details
    const enrolledStudents = await db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email
      })
      .from(users)
      .innerJoin(enrollments, eq(users.id, enrollments.userId))
      .where(eq(enrollments.courseId, courseId))
      .orderBy(users.name);
    
    // Get all submissions for this course (across all assignments and students)
    // Using batching to handle large datasets efficiently
    const studentBatches = this.chunkArray(enrolledStudents.map((s: { userId: number }) => s.userId), this.batchSize);
    
    // Process each batch of students
    const studentsWithProgress = [];
    
    for (const batchUserIds of studentBatches) {
      // Get all submissions from students in this batch
      const studentSubmissions = await db
        .select({
          id: submissions.id,
          userId: submissions.userId,
          assignmentId: submissions.assignmentId,
          status: submissions.status,
          createdAt: submissions.createdAt
        })
        .from(submissions)
        .where(and(
          inArray(submissions.userId, batchUserIds as number[]),
          inArray(submissions.assignmentId, courseAssignments.map((a: { id: number }) => a.id))
        ))
        .orderBy(submissions.createdAt);
      
      // Get feedback for all submissions
      const submissionIds = studentSubmissions.map((s: { id: number }) => s.id);
      const feedbackItems = submissionIds.length > 0
        ? await db
            .select()
            .from(feedback)
            .where(inArray(feedback.submissionId, submissionIds))
        : [];
      
      // Create a map for easy lookup of feedback
      const feedbackMap = new Map();
      for (const item of feedbackItems) {
        feedbackMap.set(item.submissionId, item);
      }
      
      // Group submissions by student
      const submissionsByStudent = new Map();
      for (const submission of studentSubmissions) {
        if (!submissionsByStudent.has(submission.userId)) {
          submissionsByStudent.set(submission.userId, []);
        }
        
        // Add feedback to submission if available
        const submissionWithFeedback = {
          ...submission,
          feedback: feedbackMap.get(submission.id) || null
        };
        
        submissionsByStudent.get(submission.userId).push(submissionWithFeedback);
      }
      
      // Calculate progress for each student in the batch
      for (const student of enrolledStudents.filter((s: { userId: number }) => batchUserIds.includes(s.userId))) {
        const studentSubmissions = submissionsByStudent.get(student.userId) || [];
        
        // Calculate completion rate (completed submissions / total assignments)
        const completedCount = studentSubmissions.filter((s: { status: string }) => s.status === 'completed').length;
        const completionRate = courseAssignments.length > 0
          ? completedCount / courseAssignments.length
          : 0;
        
        // Calculate average score across all submissions with feedback
        const submissionsWithScores = studentSubmissions.filter((s: { 
          feedback?: { score?: number } 
        }) => s.feedback && typeof s.feedback.score === 'number');
        
        const totalScore = submissionsWithScores.reduce(
          (sum: number, s: { feedback: { score?: number } }) => sum + (s.feedback.score || 0), 
          0
        );
        
        const averageScore = submissionsWithScores.length > 0
          ? totalScore / submissionsWithScores.length
          : 0;
        
        // Add to result
        studentsWithProgress.push({
          userId: student.userId,
          name: student.name,
          email: student.email,
          completionRate,
          averageScore,
          completedAssignments: completedCount,
          totalAssignments: courseAssignments.length,
          submissions: studentSubmissions
        });
      }
    }
    
    // Calculate course-level statistics
    const avgCompletionRate = studentsWithProgress.length > 0
      ? studentsWithProgress.reduce((sum, s) => sum + s.completionRate, 0) / studentsWithProgress.length
      : 0;
    
    const avgScore = studentsWithProgress.length > 0
      ? studentsWithProgress.reduce((sum, s) => sum + s.averageScore, 0) / studentsWithProgress.length
      : 0;
    
    // Return comprehensive progress data
    return {
      courseId,
      courseName: course.name,
      totalStudents: enrolledStudents.length,
      totalAssignments: courseAssignments.length,
      avgCompletionRate,
      avgScore,
      assignments: courseAssignments,
      students: studentsWithProgress
    };
  }
  
  /**
   * Batch enroll multiple students in a course
   * @param courseId The course ID to enroll students in
   * @param studentIds Array of student IDs to enroll
   */
  async batchEnrollStudents(courseId: number, studentIds: number[]): Promise<{ success: number; failed: number }> {
    // Validate the course
    const course = await storage.getCourse(courseId);
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }
    
    // Process in batches to avoid memory issues with large student lists
    let successCount = 0;
    let failedCount = 0;
    
    for (let i = 0; i < studentIds.length; i += this.batchSize) {
      const batchIds = studentIds.slice(i, i + this.batchSize);
      
      // Bulk check which students already exist in the course
      const existingEnrollments = await db
        .select({ userId: enrollments.userId })
        .from(enrollments)
        .where(and(
          eq(enrollments.courseId, courseId),
          inArray(enrollments.userId, batchIds)
        ));
      
      // Create a set of already enrolled student IDs for faster lookup
      const existingStudentIds = new Set(existingEnrollments.map((e: { userId: number }) => e.userId));
      
      // Filter out students who are already enrolled
      const studentsToEnroll = batchIds.filter(id => !existingStudentIds.has(id));
      
      // Process enrollments
      try {
        // Create enrollment records in bulk
        const enrollmentData = studentsToEnroll.map(userId => ({
          userId,
          courseId,
        }));
        
        if (enrollmentData.length > 0) {
          // Use bulk insert
          const result = await db
            .insert(enrollments)
            .values(enrollmentData)
            .returning({ id: enrollments.id });
          
          successCount += result.length;
        }
        
        // Count already enrolled as "successful" since they're already enrolled
        successCount += existingStudentIds.size;
      } catch (error) {
        console.error(`Error in batch enrollment:`, error);
        failedCount += studentsToEnroll.length;
      }
    }
    
    return { success: successCount, failed: failedCount };
  }
  
  /**
   * Generate a CSV for assignment grades across a course
   * Optimized for large classes
   * @param courseId The course ID to export grades for
   */
  async exportCourseGrades(courseId: number): Promise<string> {
    // Get all assignments for this course
    const courseAssignments = await db
      .select({
        id: assignments.id,
        title: assignments.title
      })
      .from(assignments)
      .where(eq(assignments.courseId, courseId))
      .orderBy(assignments.dueDate);
    
    // Get all enrolled students
    const enrolledStudents = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email
      })
      .from(users)
      .innerJoin(enrollments, eq(users.id, enrollments.userId))
      .where(eq(enrollments.courseId, courseId))
      .orderBy(users.name);
    
    // For CSV generation
    const csvHeader = [
      'Student ID', 
      'Name', 
      'Email',
      ...courseAssignments.map((a: { title: string }) => a.title)
    ];
    
    // Initialize the data array for CSV
    const csvData: (string | number | null)[][] = [];
    
    // Process in chunks to avoid memory issues with large classes
    // Cast enrolledStudents to Student[] type for proper typing
    const typedStudents = enrolledStudents as Student[];
    const studentChunks = this.chunkArray(typedStudents, this.batchSize);
    
    for (const studentChunk of studentChunks) {
      // Get all student IDs in this chunk with proper typing
      const studentIds = studentChunk.map(s => s.id);
      
      // Get all assignments and their most recent submission scores in bulk
      // This is much more efficient than querying each student+assignment combination
      const submissionScores = await this.getSubmissionScores(studentIds, courseAssignments.map((a: { id: number }) => a.id));
      
      // Generate a row for each student
      for (const student of studentChunk) {
        const studentRow = [
          student.id.toString(),
          student.name,
          student.email
        ];
        
        // Add the scores for each assignment
        for (const assignment of courseAssignments) {
          // Look up the score using a composite key
          const key = `${student.id}-${assignment.id}`;
          const score = submissionScores.get(key);
          // Convert null to string 'N/A' for consistent CSV data typing
          studentRow.push(score !== undefined ? score?.toString() || 'N/A' : 'N/A');
        }
        
        csvData.push(studentRow);
      }
    }
    
    // Generate CSV
    return new Promise((resolve, reject) => {
      stringify(
        [csvHeader, ...csvData], 
        { 
          header: false,
          quoted: true 
        }, 
        (err, output) => {
          if (err) reject(err);
          else resolve(output);
        }
      );
    });
  }
  
  /**
   * Get submission scores for multiple students and assignments at once
   * This is much more efficient than individual queries
   */
  private async getSubmissionScores(
    studentIds: number[],
    assignmentIds: number[]
  ): Promise<Map<string, number | null>> {
    // Use a subquery to find the latest submission for each student/assignment
    const latestSubmissions = await db
      .select({
        submissionId: submissions.id,
        userId: submissions.userId,
        assignmentId: submissions.assignmentId
      })
      .from(submissions)
      .where(and(
        inArray(submissions.userId, studentIds),
        inArray(submissions.assignmentId, assignmentIds),
        eq(submissions.status, 'completed')
      ))
      .orderBy(submissions.createdAt);
      
    // If no submissions, return empty map
    if (latestSubmissions.length === 0) {
      return new Map();
    }
    
    // Get submission IDs
    const submissionIds = latestSubmissions.map((s: { submissionId: number }) => s.submissionId);
    
    // Get feedback scores for these submissions
    const feedbackScores = await db
      .select({
        submissionId: feedback.submissionId,
        score: feedback.score
      })
      .from(feedback)
      .where(inArray(feedback.submissionId, submissionIds));
    
    // Create a map of submission ID to score with proper typing
    const scoreMap = new Map<number, number | null>();
    for (const fs of feedbackScores) {
      scoreMap.set(fs.submissionId, fs.score === null ? null : Number(fs.score));
    }
    
    // Create a map of student-assignment to score
    const result = new Map<string, number | null>();
    
    // Map each student-assignment pair to its score
    for (const submission of latestSubmissions as SubmissionRecord[]) {
      const key = `${submission.userId}-${submission.assignmentId}`;
      const score = scoreMap.get(submission.submissionId);
      // Ensure we only set numeric values or null
      result.set(key, score ?? null);
    }
    
    return result;
  }
  
  /**
   * Get aggregated statistics for a course
   * @param courseId The course ID to get statistics for
   */
  async getCourseStats(courseId: number): Promise<{
    enrollmentCount: number,
    assignmentCount: number,
    submissionCount: number,
    avgSubmissionsPerStudent: number,
    avgScores: { assignmentId: number, avgScore: number }[]
  }> {
    // Define count result type
    type CountResult = { count: number | bigint }[];
    
    // Get counts using a single query for efficiency
    const [enrollmentCount, assignmentCount, submissionCount] = await Promise.all([
      // Count enrollments
      db.select({ count: count() })
        .from(enrollments)
        .where(eq(enrollments.courseId, courseId))
        .then((result: CountResult) => Number(result[0]?.count || 0)),
      
      // Count assignments
      db.select({ count: count() })
        .from(assignments)
        .where(eq(assignments.courseId, courseId))
        .then((result: CountResult) => Number(result[0]?.count || 0)),
      
      // Count submissions (this is more complex - we need to join tables)
      db.select({ count: count() })
        .from(submissions)
        .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
        .where(eq(assignments.courseId, courseId))
        .then((result: CountResult) => Number(result[0]?.count || 0))
    ]);
    
    // Calculate average submissions per student
    const avgSubmissionsPerStudent = enrollmentCount > 0 
      ? submissionCount / enrollmentCount 
      : 0;
    
    // Get average scores per assignment using SQL aggregation
    const avgScores = await db
      .select({
        assignmentId: assignments.id,
        avgScore: sql<number>`avg(${feedback.score})`
      })
      .from(feedback)
      .innerJoin(submissions, eq(feedback.submissionId, submissions.id))
      .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
      .where(eq(assignments.courseId, courseId))
      .groupBy(assignments.id);
    
    return {
      enrollmentCount,
      assignmentCount,
      submissionCount,
      avgSubmissionsPerStudent,
      avgScores
    };
  }
  
  /**
   * Utility method to chunk an array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Export singleton instance
export const batchOperations = new BatchOperationsService();
