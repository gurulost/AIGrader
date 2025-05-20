import { InsertFeedback, Rubric, CriteriaScore, InstructorContext } from '@shared/schema';
import { AIAdapter, MultimodalPromptPart } from '../adapters/ai-adapter';
import { processFileForMultimodal } from '../utils/multimodal-processor';
import { ContentType, determineContentType } from '../utils/file-type-settings';

interface SubmissionAnalysisRequest {
  studentSubmissionContent: string;
  assignmentTitle: string;
  assignmentDescription?: string;
  instructorContext?: InstructorContext; // Hidden information from instructor to AI only
  rubric?: Rubric;
}

interface MultimodalSubmissionAnalysisRequest {
  filePath?: string;               // Path to the uploaded file (optional if fileBuffer is provided)
  fileBuffer?: Buffer;             // Buffer with file content (optional if filePath is provided)
  fileDataUri?: string;            // Data URI representation of the file (for small images)
  fileName: string;                // Original file name
  mimeType: string;                // MIME type of the file
  textContent?: string;            // Optional extracted text content
  assignmentTitle: string;
  assignmentDescription?: string;
  instructorContext?: InstructorContext; // Hidden information from instructor to AI only
  rubric?: Rubric;
}

interface FeedbackResponse {
  strengths: string[];
  improvements: string[];
  suggestions: string[];
  summary: string;
  criteriaScores?: CriteriaScore[];
  score?: number;
  processingTime: number;
  rawResponse: Record<string, unknown>;
  modelName: string;
  tokenCount: number;
}

export class AIService {
  private adapter: AIAdapter;

  constructor(adapter: AIAdapter) {
    this.adapter = adapter;
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use analyzeSubmission instead
   */
  async analyzeProgrammingAssignment(submission: { content: string; assignmentContext?: string }): Promise<FeedbackResponse> {
    return this.analyzeSubmission({
      studentSubmissionContent: submission.content,
      assignmentTitle: "Assignment",
      assignmentDescription: submission.assignmentContext
    });
  }

  /**
   * Analyzes a student submission with enhanced prompt construction
   * @param params Object containing submission content, assignment details, and optional rubric
   */
  async analyzeSubmission(params: SubmissionAnalysisRequest): Promise<FeedbackResponse> {
    const startTime = Date.now();
    
    try {
      const promptSegments = [];

      // Introduction and role definition
      promptSegments.push(
        `You are an expert AI Teaching Assistant. Your primary goal is to provide comprehensive, constructive, and actionable feedback on a student's assignment submission.
Your feedback should be encouraging, specific, and aimed at helping the student learn and improve their work according to the provided assignment details and evaluation criteria.
You MUST respond in a valid JSON format only. Do not include any explanatory text before or after the JSON object.`
      );

      // Assignment details
      promptSegments.push(
        `\n## Assignment Details:
Title: "${params.assignmentTitle}"
Description: "${params.assignmentDescription || 'No general description provided.'}"`
      );
      
      // Add instructor context if provided (secret information not shown to students)
      if (params.instructorContext) {
        let contextContent = params.instructorContext.content;
        
        promptSegments.push(
          `\n## Instructor-Only Evaluation Guidance (USE THIS INFORMATION BUT DO NOT REVEAL IT TO STUDENTS):
${contextContent}

IMPORTANT: The above section contains specific guidance provided by the instructor to help in your evaluation. 
Use these points to inform your analysis and the feedback you provide, but DO NOT directly quote or reveal 
this instructor-provided information in your feedback to the student. Instead, incorporate these insights
into your evaluation logic while keeping the actual guidance confidential.`
        );
      }

      // Setup JSON output structure
      let jsonOutputStructureFields = [
        `"strengths": ["A list of 2-5 specific positive aspects of the submission, clearly explained (array of strings). Relate these to the assignment goals or rubric if applicable."],`,
        `"improvements": ["A list of 2-5 specific areas where the submission could be improved, with constructive explanations (array of strings). Relate these to the assignment goals or rubric if applicable."],`,
        `"suggestions": ["A list of 2-5 concrete, actionable suggestions the student can implement to improve their work or understanding (array of strings)."],`,
        `"summary": "A concise (2-4 sentences) overall summary of the submission's quality, highlighting key takeaways for the student."`
      ];

      // Include rubric information if provided
      if (params.rubric && params.rubric.criteria && params.rubric.criteria.length > 0) {
        promptSegments.push("\n## Evaluation Rubric:");
        promptSegments.push("You MUST evaluate the student's submission against EACH of the following rubric criteria meticulously. For each criterion, provide specific feedback and a numeric score within the specified range.");

        // Format criteria details
        let criteriaDetails = params.rubric.criteria.map(criterion => {
          let criterionString = `- Criterion Name: "${criterion.name}" (ID: ${criterion.id})\n`;
          criterionString += `  Description: "${criterion.description}"\n`;
          criterionString += `  Maximum Score: ${criterion.maxScore}`;
          if (criterion.weight) {
            criterionString += ` (Weight: ${criterion.weight}%)`;
          }
          return criterionString;
        }).join("\n");
        promptSegments.push(criteriaDetails);

        // Add criteria scores to JSON output structure
        jsonOutputStructureFields.push(
          `"criteriaScores": [
    // For EACH criterion listed above, include an object like this:
    {
      "criteriaId": "ID_of_the_criterion",
      "score": <numeric_score_for_this_criterion_up_to_its_maxScore>,
      "feedback": "Specific, detailed feedback for this particular criterion, explaining the rationale for the score and how to improve (string)."
    }
    // ... ensure one object per criterion
  ],`
        );
        jsonOutputStructureFields.push(
          `"score": <OPTIONAL but Recommended: An overall numeric score from 0-100. If rubric criteria have weights, attempt to calculate a weighted average. Otherwise, provide a holistic quality score.>`
        );
      } else {
        // General evaluation guidelines when no rubric is provided
        promptSegments.push(
          `\n## General Evaluation Focus (No specific rubric provided):
Please analyze the submission for:
1.  Clarity, coherence, and organization of the content.
2.  Fulfillment of the assignment requirements as per the description.
3.  Identification of strengths and positive aspects.
4.  Areas that could be improved, with constructive explanations.
5.  Actionable suggestions for the student.
6.  If the submission appears to be code or involves technical problem-solving, also consider aspects like correctness, efficiency (if discernible), and clarity/documentation.`
        );
        jsonOutputStructureFields.push(
          `"criteriaScores": [] // Empty array as no specific rubric criteria were provided for itemized scoring.`
        );
        jsonOutputStructureFields.push(
          `"score": <A numeric score from 0-100 representing the overall quality based on the general evaluation focus above.>`
        );
      }

      // JSON output structure instructions
      promptSegments.push(
        `\n## JSON Output Structure:
Your response MUST be a single, valid JSON object adhering to the following structure. Ensure all string values are properly escaped within the JSON.
{
  ${jsonOutputStructureFields.join("\n  ")}
}`
      );

      // Student submission content
      promptSegments.push(
        `\n## Student's Submission Content to Evaluate:
\`\`\`
${params.studentSubmissionContent}
\`\`\`
`
      );

      // Final instruction
      promptSegments.push("\nProvide your feedback now as a single, valid JSON object:");

      // Combine all sections into the final prompt
      const finalPrompt = promptSegments.join("\n");

      // Create a system prompt for text submissions
      const systemPrompt = `You are an expert AI Teaching Assistant analyzing a text-based submission.
Your task is to provide precise, detailed, and constructive feedback on the student's work.

Your feedback should be:
- Specific and reference exact elements in the submission
- Constructive and actionable
- Balanced, noting both strengths and areas for improvement
- Free of personal opinions or bias
- Focused on helping the student improve

Respond ONLY with valid, complete JSON matching the requested structure.
Do not include explanatory text, comments, or markdown outside the JSON object.`;

      console.log(`[AIService] Using system prompt for text submission (${systemPrompt.length} chars)`);
      
      // Send to AI adapter with system prompt
      const response = await this.adapter.generateCompletion(finalPrompt, systemPrompt);
      
      const processingTime = Date.now() - startTime;
      
      return {
        ...response,
        processingTime
      };
    } catch (error: unknown) {
      console.error('AI submission analysis error:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to analyze submission: ${error.message}`);
      } else {
        throw new Error(`Failed to analyze submission: ${String(error)}`);
      }
    }
  }

  /**
   * Analyzes an image submission using Gemini's multimodal capabilities
   * @param params Object containing the image path and assignment context
   */
  async analyzeImageSubmission(params: { imagePath: string; assignmentContext?: string }): Promise<FeedbackResponse> {
    return this.analyzeMultimodalSubmission({
      filePath: params.imagePath,
      fileName: params.imagePath.split('/').pop() || 'image.jpg',
      mimeType: 'image/jpeg', // Default mime type, the processFileForMultimodal will detect the actual type
      assignmentTitle: "Image Analysis",
      assignmentDescription: params.assignmentContext
    });
  }

  /**
   * Analyzes a document submission (PDF, DOCX, etc.)
   * @param params Object containing the document path and assignment context
   */
  async analyzeDocumentSubmission(params: { documentPath: string; assignmentContext?: string }): Promise<FeedbackResponse> {
    return this.analyzeMultimodalSubmission({
      filePath: params.documentPath,
      fileName: params.documentPath.split('/').pop() || 'document.pdf',
      mimeType: 'application/pdf', // Default mime type, the processFileForMultimodal will detect the actual type
      assignmentTitle: "Document Analysis",
      assignmentDescription: params.assignmentContext
    });
  }

  /**
   * Analyzes a multimodal student submission (images, PDFs, etc.)
   * @param params Object containing file information, assignment details, and optional rubric
   */
  async analyzeMultimodalSubmission(params: MultimodalSubmissionAnalysisRequest): Promise<FeedbackResponse> {
    const startTime = Date.now();
    
    try {
      console.log(`[AIService] Analyzing multimodal submission: ${params.fileName} (${params.mimeType})`);
      
      let processedFile;
      
      // Handle file data in different forms (data URI, buffer, or path)
      if (params.fileDataUri && params.mimeType.startsWith('image/')) {
        // Use data URI for small images for reliable processing
        console.log(`[AIService] Processing image from data URI`);
        let contentType: ContentType = 'image';
        
        processedFile = {
          content: params.fileDataUri, // Use the data URI directly
          contentType,
          mimeType: params.mimeType,
          textContent: params.textContent
        };
      } else if (params.fileBuffer) {
        console.log(`[AIService] Processing file from buffer (${params.fileBuffer.length} bytes)`);
        // If we have a buffer (from multer memory storage), process it directly
        
        // Determine content type based on MIME type
        let contentType: ContentType = 'image';
        
        if (params.mimeType.startsWith('image/')) {
          contentType = 'image';
        } else if (params.mimeType.startsWith('text/') || 
                  params.mimeType.includes('javascript') || 
                  params.mimeType.includes('json')) {
          contentType = 'text';
        } else if (params.mimeType.includes('pdf') || 
                  params.mimeType.includes('word') || 
                  params.mimeType.includes('excel') || 
                  params.mimeType.includes('powerpoint') || 
                  params.mimeType.includes('document')) {
          contentType = 'document';
        } else if (params.mimeType.startsWith('audio/')) {
          contentType = 'audio';
        } else if (params.mimeType.startsWith('video/')) {
          contentType = 'video';
        }
        
        processedFile = {
          content: params.fileBuffer,
          contentType,
          mimeType: params.mimeType,
          textContent: params.textContent
        };
      } else if (params.filePath) {
        // Process the file from a path
        // This automatically handles both local paths and remote URLs (S3, HTTP)
        processedFile = await processFileForMultimodal(
          params.filePath,
          params.fileName,
          params.mimeType
        );
      } else {
        throw new Error("Either filePath or fileBuffer must be provided");
      }
      
      console.log(`[AIService] File processed, content type: ${processedFile.contentType}`);
      
      // If the adapter doesn't support multimodal input, fallback to text analysis
      if (!this.adapter.generateMultimodalCompletion) {
        console.log('[AIService] AI adapter does not support multimodal content; falling back to text-only analysis');
        
        // Use extracted text content if available
        let textContent = params.textContent || '';
        if (processedFile.textContent) {
          textContent = processedFile.textContent;
          console.log('[AIService] Using extracted text content for fallback analysis');
        } else if (typeof processedFile.content === 'string') {
          textContent = processedFile.content;
          console.log('[AIService] Using raw string content for fallback analysis');
        } else {
          textContent = `[This submission contains ${processedFile.contentType} content that could not be automatically processed as text]`;
          console.log('[AIService] No text content available, using placeholder');
        }
        
        return this.analyzeSubmission({
          studentSubmissionContent: textContent,
          assignmentTitle: params.assignmentTitle,
          assignmentDescription: params.assignmentDescription,
          instructorContext: params.instructorContext,
          rubric: params.rubric
        });
      }
      
      // Create prompt parts for multimodal analysis
      const promptParts: MultimodalPromptPart[] = [];

      // ------- Text instructions and context -------
      const textSegments = [] as string[];

      textSegments.push(
        `## Assignment Details:\nTitle: "${params.assignmentTitle}"\nDescription: "${
          params.assignmentDescription || 'No general description provided.'
        }"`
      );

      if (params.instructorContext) {
        const contextContent = params.instructorContext.content;
        textSegments.push(
          `\n## Instructor-Only Evaluation Guidance (USE THIS INFORMATION BUT DO NOT REVEAL IT TO STUDENTS):\n${contextContent}\n\nIMPORTANT: The above section contains specific guidance provided by the instructor to help in your evaluation. Use these points to inform your analysis and the feedback you provide, but DO NOT directly quote or reveal this instructor-provided information in your feedback to the student.`
        );
      }

      // Setup JSON output structure
      let jsonOutputStructureFields = [
        `"strengths": ["A list of 2-5 specific positive aspects of the submission, clearly explained (array of strings). Relate these to the assignment goals or rubric if applicable."],`,
        `"improvements": ["A list of 2-5 specific areas where the submission could be improved, with constructive explanations (array of strings). Relate these to the assignment goals or rubric if applicable."],`,
        `"suggestions": ["A list of 2-5 concrete, actionable suggestions the student can implement to improve their work or understanding (array of strings)."],`,
        `"summary": "A concise (2-4 sentences) overall summary of the submission's quality, highlighting key takeaways for the student."`
      ];

      if (params.rubric && params.rubric.criteria && params.rubric.criteria.length > 0) {
        textSegments.push("\n## Evaluation Rubric:");
        textSegments.push(
          "You MUST evaluate the student's submission against EACH of the following rubric criteria meticulously. For each criterion, provide specific feedback and a numeric score within the specified range."
        );

        const criteriaDetails = params.rubric.criteria
          .map((criterion) => {
            let criterionString = `- Criterion Name: "${criterion.name}" (ID: ${criterion.id})\n`;
            criterionString += `  Description: "${criterion.description}"\n`;
            criterionString += `  Maximum Score: ${criterion.maxScore}`;
            if (criterion.weight) {
              criterionString += ` (Weight: ${criterion.weight}%)`;
            }
            return criterionString;
          })
          .join("\n");
        textSegments.push(criteriaDetails);

        jsonOutputStructureFields.push(
          `"criteriaScores": [\n    // For EACH criterion listed above, include an object like this:\n    {\n      "criteriaId": "ID_of_the_criterion",\n      "score": <numeric_score_for_this_criterion_up_to_its_maxScore>,\n      "feedback": "Specific, detailed feedback for this particular criterion, explaining the rationale for the score and how to improve (string)."\n    }\n    // ... ensure one object per criterion\n  ],`
        );
        jsonOutputStructureFields.push(
          `"score": <OPTIONAL but Recommended: An overall numeric score from 0-100. If rubric criteria have weights, attempt to calculate a weighted average. Otherwise, provide a holistic quality score.>`
        );
      } else {
        textSegments.push(
          `\n## General Evaluation Focus (No specific rubric provided):\nPlease analyze the submission for:\n1.  Clarity, coherence, and organization of the content.\n2.  Fulfillment of the assignment requirements as per the description.\n3.  Identification of strengths and positive aspects.\n4.  Areas that could be improved, with constructive explanations.\n5.  Actionable suggestions for the student.\n6.  If the submission appears to be code or involves technical problem-solving, also consider aspects like correctness, efficiency (if discernible), and clarity/documentation.`
        );
        jsonOutputStructureFields.push(
          `"criteriaScores": [] // Empty array as no specific rubric criteria were provided for itemized scoring.`
        );
        jsonOutputStructureFields.push(
          `"score": <A numeric score from 0-100 representing the overall quality based on the general evaluation focus above.>`
        );
      }

      textSegments.push(
        `\n## JSON Output Structure:\nYour response MUST be a single, valid JSON object adhering to the following structure. Ensure all string values are properly escaped within the JSON.\n{\n  ${jsonOutputStructureFields.join("\n  ")}\n}`
      );

      textSegments.push(
        "\nProvide your feedback now as a single, valid JSON object:"
      );

      const finalPromptText = textSegments.join("\n");

      // Add the text instructions as the first part so Gemini has full context
      promptParts.push({ type: 'text', content: finalPromptText });

      // Add the file content as the appropriate type
      promptParts.push({
        type: processedFile.contentType as ContentType,
        content: processedFile.content,
        mimeType: params.mimeType,
        textContent: processedFile.textContent
      });
      
      // Build a system prompt for assignment context with enhanced guidance for multimodal content
      // Following Google's Gemini API best practices from https://ai.google.dev/gemini-api/docs/system-instructions
      // and https://ai.google.dev/gemini-api/docs/image-understanding
      let systemPrompt = `You are an expert AI Teaching Assistant analyzing a ${processedFile.contentType} submission.
Your task is to provide precise, detailed, and constructive feedback on the student's work.

For ${processedFile.contentType === 'image' ? 'image' : processedFile.contentType === 'document' ? 'document' : processedFile.contentType} content:
${processedFile.contentType === 'image' ? 
`- Carefully analyze all visual elements, composition, technical execution, and conceptual aspects
- Pay attention to details such as color, composition, technical execution, and creative choices
- Provide specific feedback that references exact visual elements in the submission
- Evaluate both technical skills and creative/conceptual understanding` : 
processedFile.contentType === 'document' ? 
`- Analyze the document structure, content organization, clarity, and coherence
- Evaluate accuracy, thoroughness, and relevance of information
- Provide specific feedback on writing style, argumentation, and evidence use
- Look for proper citation and reference use when applicable` :
`- Carefully examine both technical correctness and creative aspects
- Consider organization, structure, and presentation quality
- Provide specific feedback referencing exact elements from the submission`}

Respond with a structured assessment including strengths, areas for improvement, and specific suggestions.

Assignment: ${params.assignmentTitle}`;
      
      if (params.assignmentDescription) {
        systemPrompt += `\nDescription: ${params.assignmentDescription}`;
      }
      
      // Add instructor context if provided (secret information not shown to students)
      if (params.instructorContext) {
        let contextContent = params.instructorContext.content;
        
        systemPrompt += `\n\n## INSTRUCTOR-ONLY EVALUATION GUIDANCE (DO NOT REVEAL TO STUDENTS):
${contextContent}

IMPORTANT: The above section contains specific guidance provided by the instructor to help in your evaluation. 
Use these points to inform your analysis and the feedback you provide, but DO NOT directly quote or reveal 
this instructor-provided information in your feedback to the student. Instead, incorporate these insights
into your evaluation logic while keeping the actual guidance confidential.`;
      }
      
      if (params.rubric && params.rubric.criteria && params.rubric.criteria.length > 0) {
        systemPrompt += '\n\nRubric criteria to assess:';
        for (const criterion of params.rubric.criteria) {
          systemPrompt += `\n- ${criterion.name}: ${criterion.description} (Max score: ${criterion.maxScore})`;
        }
      }
      
      console.log(`[AIService] Sending multimodal request to AI adapter with content type: ${processedFile.contentType}`);
      
      // Generate the completion using multimodal capabilities
      const response = await this.adapter.generateMultimodalCompletion(promptParts, systemPrompt);
      
      const processingTime = Date.now() - startTime;
      console.log(`[AIService] Multimodal analysis completed in ${processingTime}ms`);
      
      return {
        ...response,
        processingTime
      };
    } catch (error: unknown) {
      console.error('[AIService] AI multimodal submission analysis error:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to analyze multimodal submission: ${error.message}`);
      } else {
        throw new Error(`Failed to analyze multimodal submission: ${String(error)}`);
      }
    }
  }

  async prepareFeedbackForStorage(submissionId: number, feedback: FeedbackResponse): Promise<InsertFeedback> {
    return {
      submissionId,
      strengths: feedback.strengths,
      improvements: feedback.improvements,
      suggestions: feedback.suggestions,
      summary: feedback.summary,
      score: feedback.score,
      criteriaScores: feedback.criteriaScores,
      processingTime: feedback.processingTime,
      rawResponse: feedback.rawResponse,
      modelName: feedback.modelName,
      tokenCount: feedback.tokenCount
    };
  }
}
