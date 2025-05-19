/**
 * Gemini AI adapter for the AI Grader platform
 * Using @google/genai SDK with the latest API patterns for version 0.14.0+
 */
// Import the correct types from @google/genai
import { 
  GoogleGenAI, 
  GenerateContentResponse,
  Part
} from '@google/genai';

// Token budget constants for two-step approach
const BASE_MAX_TOKENS = 1200;   // first attempt
const RETRY_MAX_TOKENS = 1600;  // if finishReason !== "STOP"

// The newest Gemini model is "gemini-2.5-flash-preview-04-17" which was released April 17, 2025
import { ContentType } from '../utils/file-type-settings';
import { AIAdapter, MultimodalPromptPart } from './ai-adapter';
import { CriteriaScore } from '@shared/schema';
import { parseStrict } from '../utils/json-parser';
import { GradingFeedback, SCHEMA_VERSION, gradingJSONSchema } from '../schemas/gradingSchema';
import { sanitizeText, detectInjectionAttempt } from '../utils/text-sanitizer';
import { isSchemaError, shouldRetry, SchemaValidationError } from '../utils/schema-errors';
import { pruneForGemini } from '../utils/schema-pruner';
import { createFileData, GeminiFileData, toSDKFormat, shouldUseFilesAPI } from '../utils/gemini-file-handler';
import { repairJson } from '../utils/json-repair';

// These are the MIME types supported by Google Gemini API
// Based on https://ai.google.dev/gemini-api/docs/
export const SUPPORTED_MIME_TYPES = {
  // Images
  image: [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 
    'image/heic', 'image/heif', 'image/svg+xml', 'image/gif',
    'image/bmp', 'image/tiff'
  ],
  
  // Video 
  video: [
    'video/mp4', 'video/mpeg', 'video/webm', 'video/quicktime',
    'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv'
  ],
  
  // Audio
  audio: [
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm',
    'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-m4a', 'audio/mp3'
  ],
  
  // Documents
  document: [
    // Standard document formats
    'application/pdf', 
    // Text formats
    'text/csv', 'text/plain', 'application/json', 'text/markdown', 'text/html',
    // Office formats
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/msword', // .doc
    'application/vnd.ms-excel', // .xls
    'application/vnd.ms-powerpoint', // .ppt
    // Open document formats
    'application/vnd.oasis.opendocument.text', // .odt
    'application/vnd.oasis.opendocument.spreadsheet', // .ods
    'application/vnd.oasis.opendocument.presentation', // .odp
  ]
};

// This implements the standard AIAdapter interface for Gemini

/**
 * Google Gemini AI adapter for generating feedback
 * Using the latest API methods from the @google/genai SDK
 */
export class GeminiAdapter implements AIAdapter {
  private genAI: GoogleGenAI;
  private modelName: string;
  private processingStart: number;
  
  // Use a pruned version of the JSON schema from gradingSchema.ts
  // Gemini only supports a subset of JSON Schema fields
  private readonly responseSchema: any;
  
  // File cache cleanup interval
  private fileCacheCleanupInterval: NodeJS.Timeout | null = null;
  
  /**
   * Create a new GeminiAdapter instance
   */
  constructor() {
    // Get API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is required");
    }
    
    // Initialize the Google Generative AI client
    this.genAI = new GoogleGenAI({ apiKey });
    
    // Make model name configurable with environment variable or use default
    this.modelName = process.env.GEMINI_MODEL_NAME ?? "gemini-2.5-flash-preview-04-17";
    
    console.log(`[GEMINI] Initializing with model: ${this.modelName}`);
    
    // Initialize processing timer
    this.processingStart = Date.now();
    
    // Prune the schema to remove fields not supported by Gemini API
    // This prevents the "Unknown name" errors for standard JSON Schema fields
    this.responseSchema = Object.freeze(pruneForGemini(gradingJSONSchema));
    
    console.log(`[GEMINI] Schema pruned for Gemini API compatibility`);
    
    // Start file cache cleanup
    const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
    this.fileCacheCleanupInterval = setInterval(() => {
      try {
        const now = Date.now();
        console.log(`[GEMINI] Running scheduled file cache cleanup at ${new Date(now).toISOString()}`);
        // The actual cleanup runs in gemini-file-handler.ts
      } catch (error) {
        console.error(`[GEMINI] File cache cleanup error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, CLEANUP_INTERVAL);
  }
  
  /**
   * Standard text completion
   */
  async generateCompletion(prompt: string, systemPrompt?: string) {
    try {
      console.log(`[GEMINI] Generating completion with prompt length: ${prompt.length} chars`);
      // Log preview of the prompt, truncated for privacy/security
      console.log(`[GEMINI] Prompt preview: ${prompt.slice(0, 250)}${prompt.length > 250 ? '...' : ''}`);
      
      // Reset processing timer
      this.processingStart = Date.now();
      
      // Sanitize input text to prevent prompt injection and other issues
      const sanitizedPrompt = sanitizeText(prompt, 8000);
      
      // Check for potential injection attempts
      const potentialInjection = detectInjectionAttempt(prompt);
      if (potentialInjection) {
        console.warn(
          `[GEMINI] Potential prompt injection detected in input: ` +
          `${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`
        );
      }
      
      // Log if text was truncated
      if (sanitizedPrompt.length < prompt.length) {
        console.log(`[GEMINI] Input text truncated from ${prompt.length} to ${sanitizedPrompt.length} characters`);
      }
      
      // Generation config parameters
      const temperature = 0.2;
      const topP = 0.8;
      const topK = 40;
      const maxOutputTokens = 750;
      
      // Prepare the request with proper placement of systemInstruction as a top-level field
      const requestParams: any = {
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: sanitizedPrompt }] }],
        // systemInstruction is now a top-level field, not inside config
        systemInstruction: systemPrompt, 
        config: {
          temperature,
          topP, 
          topK,
          maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: this.responseSchema
        }
      };
      
      // Log if system prompt was added
      if (systemPrompt) {
        console.log(`[GEMINI] Added system prompt as top-level systemInstruction (${systemPrompt.length} chars)`);
      }
      
      console.log(`[GEMINI] Sending request to Gemini API with responseMimeType: application/json`);
      
      // Function to handle a single API request with retry capability
      const gradeWithRetry = async (): Promise<GenerateContentResponse> => {
        try {
          return await this.genAI.models.generateContent(requestParams);
        } catch (e: any) {
          // If the error is one that might be resolved with a retry, try once more
          if (isSchemaError(e) && shouldRetry(e)) {
            console.log(`[GEMINI] API call failed with error that warrants retry: ${e.message}`);
            console.log(`[GEMINI] Retrying API call once...`);
            return await this.genAI.models.generateContent(requestParams);
          }
          throw e;
        }
      };
      
      // Always use streaming for all requests to avoid truncation issues
      // Based on recommendation #3 - adopt a single generation path
      const BASE_MAX = 1200;   // covers 99% of image feedback
      const RETRY_MAX = 1600;  // bump once on early stop
      
      // Function to run the content generation with specified token limit
      const run = async (cap: number) => {
        // Update the request with the specified token limit
        requestParams.config.maxOutputTokens = cap;
        console.log(`[GEMINI] Using streaming with token limit: ${cap}`);
        
        try {
          const stream = await this.genAI.models.generateContentStream(requestParams);
          let streamedText = '';
          let finishReason = 'STOP'; // Default to successful finish
          
          // Process the stream chunks
          for await (const chunk of stream) {
            if (chunk.candidates && 
                chunk.candidates.length > 0) {
              // Get finish reason from the last chunk if available
              if (chunk.candidates[0].finishReason) {
                finishReason = chunk.candidates[0].finishReason;
              }
              
              if (chunk.candidates[0]?.content?.parts) {
                const part = chunk.candidates[0].content.parts[0];
                if (part.text) {
                  streamedText += part.text;
                }
              }
            }
          }
          
          // Create a response object similar to non-streaming API
          const result = {
            candidates: [{
              content: {
                parts: [{ text: streamedText }]
              },
              finishReason
            }],
            // Copy usage metadata structure to maintain compatibility
            usageMetadata: requestParams.usageMetadata
          };
          
          return { result, finishReason, raw: streamedText };
        } catch (error) {
          console.error(`[GEMINI] Streaming error: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      };
      
      // First attempt with base token limit
      let { result, finishReason, raw } = await run(BASE_MAX);
      
      // If the model stopped early, retry with a higher token limit
      if (finishReason !== 'STOP') {
        console.warn(`[GEMINI] early stop ${finishReason} – retry with increased token limit`);
        ({ result, finishReason, raw } = await run(RETRY_MAX));
        
        // If still not successful, throw an error
        if (finishReason !== 'STOP') {
          throw new Error(`Gemini failed twice (reason: ${finishReason})`);
        }
      }
      
      console.log(`[GEMINI] Streaming complete, received ${raw.length} characters, finish reason: ${finishReason}`);
      
      // Log comprehensive usage information for monitoring
      if (result.usageMetadata) {
        const retryInfo = finishReason !== 'STOP' ? '(retry required)' : '';
        const metrics = {
          modelName: this.modelName,
          promptTokens: result.usageMetadata.promptTokenCount || 0,
          candidatesTokens: result.usageMetadata.candidatesTokenCount || 0,
          totalTokens: result.usageMetadata.totalTokenCount || 0,
          streamingUsed: true, // Always using streaming now
          tokenLimit: finishReason !== 'STOP' ? RETRY_MAX : BASE_MAX,
          processingTimeMs: Date.now() - this.processingStart
        };
        
        console.log(`[GEMINI] Response usage metrics ${retryInfo}:`, metrics);
      } else {
        // Log when we don't get usage metrics from the API
        console.log(`[GEMINI] No usage metrics available from API, metrics will be incomplete`);
      }
      
      // Extract text from the response
      let text = '';
      
      if (result.candidates && 
          result.candidates.length > 0 && 
          result.candidates[0]?.content?.parts) {
        const firstPart = result.candidates[0].content.parts[0];
        if (firstPart.text) {
          text = firstPart.text;
        } else {
          console.warn('[GEMINI] Response text not found in expected location');
          text = JSON.stringify(result);
        }
      } else {
        console.warn('[GEMINI] Could not extract text response from standard structure');
        text = JSON.stringify(result);
      }
      
      console.log(`[GEMINI] Response received, length: ${text.length} characters`);
      // Only log validity, not actual content for privacy
      console.log(`[GEMINI] Response format check - appears to be valid JSON: ${text.trim().startsWith('{') && text.trim().endsWith('}')}`);
      
      // Parse and validate the response with our strict parser 
      console.log(`[GEMINI] Parsing and validating JSON with schema`);
      
      let parsedContent: GradingFeedback;
      
      try {
        // Use the strict parser that validates against schema
        parsedContent = parseStrict(text);
        console.log(`[GEMINI] Successfully parsed and validated JSON response`);
      } catch (error) {
        console.error(`[GEMINI] JSON parsing or validation failed: ${error instanceof Error ? error.message : String(error)}`);
        throw new SchemaValidationError(
          `Gemini returned JSON that failed schema validation`, 
          text, 
          error
        );
      }
      
      // Use the actual token count from API if available, or set a reasonable default
      // Don't use fallback values for token count to avoid bogus cost data
      const tokenCount = result.usageMetadata?.totalTokenCount;
      
      // Return the parsed and validated content in the expected interface format
      return {
        ...parsedContent,
        modelName: this.modelName,
        rawResponse: JSON.parse(text), // Convert string to Record<string, unknown>
        tokenCount: tokenCount ?? 0 // Use 0 as fallback for the interface requirement
      };
    } catch (error) {
      console.error(`[GEMINI] Error in generateCompletion: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Multimodal completion (text + images, etc.)
   */
  async generateMultimodalCompletion(
    parts: MultimodalPromptPart[],
    systemPrompt?: string
  ) {
    try {
      console.log(`[GEMINI] Generating multimodal completion with ${parts.length} parts`);
      
      // Reset processing timer
      this.processingStart = Date.now();
      
      // Prepare content parts in the format expected by the API
      const apiParts: Part[] = [];
      
      // Process each part based on its type
      for (const part of parts) {
        if (part.type === 'text') {
          // Text parts need sanitization
          const originalText = part.content as string;
          const sanitizedText = sanitizeText(originalText, 8000);
          
          // Check for potential injection attempts
          const potentialInjection = detectInjectionAttempt(originalText);
          if (potentialInjection) {
            console.warn(
              `[GEMINI] Potential prompt injection detected in multimodal text input: ` +
              `${originalText.slice(0, 120)}${originalText.length > 120 ? '...' : ''}`
            );
          }
          
          // Log if text was truncated
          if (sanitizedText.length < originalText.length) {
            console.log(`[GEMINI] Multimodal text truncated from ${originalText.length} to ${sanitizedText.length} characters`);
          }
          
          apiParts.push({ 
            text: sanitizedText 
          });
        } 
        else if (part.type === 'image') {
          try {
            // Get file size to determine best handling approach
            let fileSize = 0;
            
            if (Buffer.isBuffer(part.content)) {
              fileSize = part.content.length;
            } else if (typeof part.content === 'string' && part.content.startsWith('data:')) {
              // It's a data URL, extract the base64 part and calculate size
              const base64Data = part.content.split(',')[1];
              fileSize = base64Data ? Math.ceil(base64Data.length * 0.75) : 0;  // base64 is ~4/3 of binary size
            }
            
            const IMAGE_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB threshold for Files API
            
            if (fileSize > IMAGE_SIZE_THRESHOLD) {
              console.log(`[GEMINI] Large image detected (${(fileSize / (1024 * 1024)).toFixed(2)}MB), using Files API`);
              
              // Use Files API for large images
              const fileData = await createFileData(
                this.genAI,
                part.content as Buffer | string,
                part.mimeType || 'image/jpeg'
              );
              
              // Convert to the SDK's expected camelCase format
              const sdkFileData = toSDKFormat(fileData);
              
              // Add file data using the SDK's expected structure
              apiParts.push({
                fileData: sdkFileData
              });
              
              console.log(`[GEMINI] Successfully uploaded large image to Files API`);
            } else {
              // Convert Buffer to base64 string if needed
              const base64Data = Buffer.isBuffer(part.content)
                ? part.content.toString('base64')
                : part.content as string;
                
              // Standard image handling for smaller files
              apiParts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: part.mimeType || 'image/jpeg'
                }
              });
              
              console.log(`[GEMINI] Added inline image data (${(fileSize / 1024).toFixed(2)}KB)`);
            }
          } catch (error) {
            console.error(`[GEMINI] Error processing image: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to process image: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        else if (part.type === 'document' || part.type === 'audio' || part.type === 'video') {
          try {
            console.log(`[GEMINI] Processing ${part.type} file with mime type ${part.mimeType || 'unknown'}`);
            
            // Upload file to Files API first, returns snake_case properly formatted GeminiFileData
            const fileData = await createFileData(
              this.genAI,
              part.content as Buffer | string,
              part.mimeType || 'application/octet-stream'
            );
            
            // Convert to the SDK's expected camelCase format
            const sdkFileData = toSDKFormat(fileData);
            
            // Add file data using the SDK's expected structure
            apiParts.push({
              fileData: sdkFileData
            });
            
            console.log(`[GEMINI] Successfully added ${part.type} file to request`);
          } catch (error) {
            console.error(`[GEMINI] Error processing ${part.type} file: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to process ${part.type} file: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // Log the number of parts being sent
      console.log(`[GEMINI] Sending ${apiParts.length} parts to the API`);
      
      // Generation config parameters
      const temperature = 0.2;
      const topP = 0.8;
      const topK = 40;
      const maxOutputTokens = 750;
      
      // Create the request object with responseSchema for JSON output
      const requestParams: any = {
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: apiParts
          }
        ],
        // Place systemInstruction at the top level, not inside config
        systemInstruction: systemPrompt,
        config: {
          temperature,
          topP,
          topK,
          maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: this.responseSchema
        }
      };
      
      if (systemPrompt) {
        console.log(`[GEMINI] Added system prompt as top-level systemInstruction (${systemPrompt.length} chars)`);
      }
      
      console.log(`[GEMINI] Sending multimodal request to Gemini API with responseMimeType: application/json`);
      
      // Function to handle a single API request with retry capability
      const gradeWithRetry = async (): Promise<GenerateContentResponse> => {
        try {
          return await this.genAI.models.generateContent(requestParams);
        } catch (e: any) {
          // If the error is one that might be resolved with a retry, try once more
          if (isSchemaError(e) && shouldRetry(e)) {
            console.log(`[GEMINI] API call failed with error that warrants retry: ${e.message}`);
            console.log(`[GEMINI] Retrying API call once...`);
            return await this.genAI.models.generateContent(requestParams);
          }
          throw e;
        }
      };
      
      // Always use streaming for multimodal content to avoid truncation issues
      // Based on recommendation #3 - adopt a single generation path
      const BASE_MAX = 1200;   // covers 99% of image feedback
      const RETRY_MAX = 1600;  // bump once on early stop
      // Function to run the content generation with specified token limit
      const run = async (cap: number) => {
        // Update the request with the specified token limit
        requestParams.config.maxOutputTokens = cap;
        console.log(`[GEMINI] Using streaming for multimodal with token limit: ${cap}`);
        
        try {
          const stream = await this.genAI.models.generateContentStream(requestParams);
          let streamedText = '';
          let finishReason = 'STOP'; // Default to successful finish
          
          // Process the stream chunks
          for await (const chunk of stream) {
            if (chunk.candidates && 
                chunk.candidates.length > 0) {
              // Get finish reason from the last chunk if available
              if (chunk.candidates[0].finishReason) {
                finishReason = chunk.candidates[0].finishReason;
              }
              
              if (chunk.candidates[0]?.content?.parts) {
                const part = chunk.candidates[0].content.parts[0];
                if (part.text) {
                  streamedText += part.text;
                }
              }
            }
          }
          
          // Create a response object similar to non-streaming API
          const result = {
            candidates: [{
              content: {
                parts: [{ text: streamedText }]
              },
              finishReason
            }],
            // Include usage metadata with the correct structure
            usageMetadata: requestParams.usageMetadata
          };
          
          return { result, finishReason, raw: streamedText };
        } catch (error) {
          console.error(`[GEMINI] Multimodal streaming error: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      };
      
      // First attempt with base token limit
      let { result, finishReason, raw } = await run(BASE_MAX);
        console.log(`[GEMINI] Using streaming for large multimodal output (maxOutputTokens: ${maxOutputTokens})`);
        // Use streaming API for large outputs to avoid truncation
        try {
          const stream = await this.genAI.models.generateContentStream(requestParams);
          let streamedText = '';
          
          // Process the stream chunks
          for await (const chunk of stream) {
            if (chunk.candidates && 
                chunk.candidates.length > 0 && 
                chunk.candidates[0]?.content?.parts) {
              const part = chunk.candidates[0].content.parts[0];
              if (part.text) {
                streamedText += part.text;
              }
            }
          }
          
          // Create a response object similar to non-streaming API
          result = {
            candidates: [{
              content: {
                parts: [{ text: streamedText }]
              }
            }]
          };
          
          console.log(`[GEMINI] Multimodal streaming complete, received ${streamedText.length} characters`);
        } catch (error) {
          console.error(`[GEMINI] Multimodal streaming error: ${error instanceof Error ? error.message : String(error)}`);
          // Fall back to non-streaming if streaming fails
          console.log(`[GEMINI] Falling back to non-streaming API for multimodal content`);
          result = await gradeWithRetry();
        }
      } else {
        // Standard API call for normal outputs
        result = await gradeWithRetry();
      }
      
      // Extract text from the response
      let text = '';
      
      if (result.candidates && 
          result.candidates.length > 0 && 
          result.candidates[0]?.content?.parts) {
        const firstPart = result.candidates[0].content.parts[0];
        if (firstPart.text) {
          text = firstPart.text;
        } else {
          console.warn('[GEMINI] Response text not found in expected location');
          text = JSON.stringify(result);
        }
      } else {
        console.warn('[GEMINI] Could not extract text response from standard structure');
        text = JSON.stringify(result);
      }
      
      console.log(`[GEMINI] Response received, length: ${text.length} characters`);
      // Only log validity, not actual content for privacy
      console.log(`[GEMINI] Response format check - appears to be valid JSON: ${text.trim().startsWith('{') && text.trim().endsWith('}')}`);
      
      // Parse and validate the response with our strict parser 
      console.log(`[GEMINI] Parsing and validating JSON with schema`);
      
      let parsedContent: GradingFeedback;
      
      try {
        // Use the strict parser that validates against schema
        parsedContent = parseStrict(text);
        console.log(`[GEMINI] Successfully parsed and validated JSON response`);
      } catch (error) {
        console.error(`[GEMINI] JSON parsing or validation failed: ${error instanceof Error ? error.message : String(error)}`);
        throw new SchemaValidationError(
          `Gemini returned JSON that failed schema validation`, 
          text, 
          error
        );
      }
      
      // Track performance
      const processingEnd = Date.now();
      
      // Use actual usage data if available, otherwise estimate
      let tokenCount = 0;
      
      if (result.usageMetadata && result.usageMetadata.totalTokenCount) {
        // Use actual token count from API if available
        tokenCount = result.usageMetadata.totalTokenCount;
        
        // Log comprehensive usage information
        const retryInfo = finishReason !== 'STOP' ? '(retry required)' : '';
        const metrics = {
          modelName: this.modelName,
          promptTokens: result.usageMetadata.promptTokenCount || 0,
          candidatesTokens: result.usageMetadata.candidatesTokenCount || 0,
          totalTokens: result.usageMetadata.totalTokenCount || 0,
          streamingUsed: true, // Always using streaming now
          multimodalParts: apiParts.length,
          processingTimeMs: Date.now() - this.processingStart
        };
        
        console.log(`[GEMINI] Multimodal response usage metrics ${retryInfo}:`, metrics);
      } else {
        // Only use the actual token count from API, no fallbacks to avoid bogus cost data
        // as per recommendation #4
        tokenCount = result.usageMetadata?.totalTokenCount;
        
        console.log(`[GEMINI] Multimodal content processed, token count: ${tokenCount ?? 'not available'}`);
      }
      
      // Return the parsed content with the interface-required format
      return {
        ...parsedContent,
        modelName: this.modelName,
        rawResponse: JSON.parse(text), // Convert string to Record<string, unknown>
        tokenCount: tokenCount ?? 0 // Use 0 as fallback for the interface requirement
      };
    } catch (error) {
      console.error(`[GEMINI] Error in generateMultimodalCompletion: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Check if a file type is supported by the Gemini API
   */
  isSupportedMimeType(mimeType: string): boolean {
    return (
      SUPPORTED_MIME_TYPES.image.includes(mimeType) ||
      SUPPORTED_MIME_TYPES.video.includes(mimeType) ||
      SUPPORTED_MIME_TYPES.audio.includes(mimeType) ||
      SUPPORTED_MIME_TYPES.document.includes(mimeType)
    );
  }
  
  /**
   * Get the content type category for a given MIME type
   */
  getContentType(mimeType: string): ContentType | undefined {
    if (SUPPORTED_MIME_TYPES.image.includes(mimeType)) {
      return 'image';
    } else if (SUPPORTED_MIME_TYPES.video.includes(mimeType)) {
      return 'video';
    } else if (SUPPORTED_MIME_TYPES.audio.includes(mimeType)) {
      return 'audio';
    } else if (SUPPORTED_MIME_TYPES.document.includes(mimeType)) {
      return 'document';
    }
    return undefined;
  }
}