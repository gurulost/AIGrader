/**
 * Gemini Adapter for AI grading
 * Optimized for Gemini SDK v0.14.0+ with improved file handling
 * 
 * This adapter handles:
 * - Text-only submissions
 * - Multimodal (text + image) submissions
 * - Document submissions (PDF, DOCX, etc.)
 * - Proper token usage tracking
 * - Metadata capture from API responses
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part } from '@google/generative-ai';
import { createFileData, shouldUseFilesAPI } from '../utils/gemini-file-handler';
import { AIAdapter, AIAdapterResponse } from './ai-adapter';
import { AIContentType, GradingFeedback, MultimodalPromptPart } from '../types';
import { pruneGeminiSchema } from '../utils/schema-utils';

// Model configuration constants
const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 2048;

// Content type mappings
type ContentType = 'text' | 'image' | 'pdf' | 'docx' | 'audio' | 'video' | 'unknown';

/**
 * Adapter for the Google Gemini API
 * Handles both text and multimodal completions with proper file handling
 */
export class GeminiAdapter implements AIAdapter {
  private genAI: any; // Use 'any' to avoid version compatibility issues
  private modelName: string;
  private processingStart: number = 0;
  private readonly responseSchema: any;

  // Default model configuration
  private readonly defaultConfig = {
    temperature: DEFAULT_TEMPERATURE,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ],
  };

  /**
   * Create a new GeminiAdapter instance with the provided API key
   */
  constructor() {
    // Initialize with API key from environment
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is required');
    }

    // Initialize the Gemini client
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    
    // Load the grading response schema (for structured outputs)
    this.responseSchema = pruneGeminiSchema({
      type: 'object',
      properties: {
        strengths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of strengths in the submission'
        },
        improvements: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of areas for improvement'
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific suggestions for improvement'
        },
        summary: {
          type: 'string',
          description: 'Overall summary of feedback'
        },
        score: {
          type: 'number',
          description: 'Overall score from 0-100'
        },
        criteriaScores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criteriaId: { type: 'string' },
              score: { type: 'number' },
              feedback: { type: 'string' }
            }
          },
          description: 'Scores for individual criteria'
        },
        schemaVersion: { type: 'string', default: '1.0' }
      },
      required: ['strengths', 'improvements', 'suggestions', 'summary', 'score']
    });
  }

  /**
   * Standard text completion
   * @param prompt The text prompt to send to the model
   * @param systemPrompt Optional system prompt for context
   * @returns Structured feedback response
   */
  async generateCompletion(prompt: string, systemPrompt?: string): Promise<AIAdapterResponse> {
    this.processingStart = Date.now();
    console.log(`[GEMINI] Processing text completion request (${this.modelName})`);
    
    try {
      // Get the model
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          ...this.defaultConfig
        },
        systemInstruction: systemPrompt
      });
      
      // Generate the completion with schema-guided structured output
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          ...this.defaultConfig
        }
      });
      
      // Extract the response
      const response = result.response;
      
      // Parse the response JSON
      let parsedContent: GradingFeedback;
      try {
        parsedContent = JSON.parse(response.text());
      } catch (error) {
        console.warn('[GEMINI] Error parsing JSON response:', error);
        throw new Error('Failed to parse Gemini response as JSON');
      }
      
      // Get usage metadata if available
      const usageMetadata = response.usageMetadata || {};
      const promptTokens = usageMetadata.promptTokenCount || 0;
      const totalTokens = usageMetadata.totalTokenCount || 0;
      const completionTokens = totalTokens - promptTokens;
      
      // Construct the structured response
      const adapterResponse: AIAdapterResponse = {
        ...parsedContent,
        rawResponse: response.candidates ? response.candidates[0] : {},
        modelName: this.modelName,
        tokenCount: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
        }
      };
      
      // Log processing time
      const processingTime = Date.now() - this.processingStart;
      console.log(`[GEMINI] Processed text completion in ${processingTime}ms (${totalTokens} tokens)`);
      
      return adapterResponse;
    } catch (error) {
      const processingTime = Date.now() - this.processingStart;
      console.error(`[GEMINI] Error processing text completion (${processingTime}ms):`, error);
      throw error;
    }
  }

  /**
   * Multimodal completion (text + images, documents, etc.)
   * @param multimodalPromptParts Array of parts (text and/or files)
   * @param systemPrompt Optional system prompt for context
   * @returns Structured feedback response
   */
  async generateMultimodalCompletion(
    multimodalPromptParts: MultimodalPromptPart[],
    systemPrompt?: string
  ): Promise<AIAdapterResponse> {
    this.processingStart = Date.now();
    console.log(`[GEMINI] Processing multimodal completion request (${this.modelName})`);
    
    // Prepare the parts for the API request
    const parts: Part[] = [];
    
    try {
      // Process each part
      for (const promptPart of multimodalPromptParts) {
        // Handle text parts
        if (promptPart.type === 'text') {
          parts.push({ text: promptPart.content as string });
          continue;
        }
        
        // For non-text parts (files)
        if (promptPart.type === 'file') {
          // Get file content and MIME type
          const source = promptPart.content;
          const mimeType = promptPart.mimeType || 'application/octet-stream';
          
          // Determine content type based on MIME type
          let contentType: AIContentType = 'image';
          if (mimeType.includes('pdf')) contentType = 'pdf';
          else if (mimeType.includes('wordprocessing') || mimeType.includes('document')) contentType = 'document';
          else if (mimeType.startsWith('audio/')) contentType = 'audio';
          else if (mimeType.startsWith('video/')) contentType = 'video';
          
          console.log(`[GEMINI] Processing ${contentType} content with MIME type: ${mimeType}`);
          
          // Get content buffer for size check
          let contentBuffer: Buffer;
          if (Buffer.isBuffer(source)) {
            contentBuffer = source;
          } else if (typeof source === 'string') {
            if (source.startsWith('data:')) {
              // Extract base64 content from data URI
              const base64 = source.split(',')[1];
              contentBuffer = Buffer.from(base64, 'base64');
            } else {
              // Treat as file path or URL, fetch content
              try {
                if (source.startsWith('http')) {
                  const response = await fetch(source);
                  if (!response.ok) {
                    throw new Error(`Failed to fetch URL: ${source} (status: ${response.status})`);
                  }
                  contentBuffer = Buffer.from(await response.arrayBuffer());
                } else {
                  // Skip fetching - let createFileData handle it
                  contentBuffer = Buffer.from([0]); // Placeholder
                }
              } catch (error) {
                console.error(`[GEMINI] Error fetching file content:`, error);
                throw new Error(`Failed to process file: ${error.message}`);
              }
            }
          } else {
            throw new Error(`Unsupported content type: ${typeof source}`);
          }
          
          // Check if we should use the Files API or inline data
          if (shouldUseFilesAPI(mimeType, contentBuffer.length)) {
            // Use Files API for large files, PDFs, DOCX, SVG, etc.
            try {
              console.log(`[GEMINI] Using Files API for ${contentType} (${(contentBuffer.length / 1024).toFixed(1)}KB)`);
              const fileData = await createFileData(this.genAI, source, mimeType);
              parts.push({ fileData });
            } catch (error) {
              console.error(`[GEMINI] Error using Files API:`, error);
              throw new Error(`Failed to process file with Files API: ${error.message}`);
            }
          } else {
            // Use inline data for small images
            console.log(`[GEMINI] Using inline data for ${contentType} (${(contentBuffer.length / 1024).toFixed(1)}KB)`);
            
            // Convert to base64 for inline data
            let base64Data: string;
            if (Buffer.isBuffer(source)) {
              base64Data = source.toString('base64');
            } else if (typeof source === 'string' && source.startsWith('data:')) {
              base64Data = source.split(',')[1];
            } else {
              // Convert from whatever format we have
              base64Data = contentBuffer.toString('base64');
            }
            
            parts.push({
              inlineData: {
                data: base64Data,
                mimeType
              }
            });
          }
        }
      }
      
      console.log(`[GEMINI] Prepared ${parts.length} parts for model input`);
      
      // Get the model with system instruction
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          ...this.defaultConfig
        },
        systemInstruction: systemPrompt
      });
      
      // Generate the completion with schema-guided structured output
      const result = await model.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          ...this.defaultConfig
        }
      });
      
      // Extract the response
      const response = result.response;
      
      // Parse the response JSON
      let parsedContent: GradingFeedback;
      try {
        parsedContent = JSON.parse(response.text());
      } catch (error) {
        console.warn('[GEMINI] Error parsing JSON response:', error);
        throw new Error(`Failed to parse Gemini response as JSON: ${error.message}`);
      }
      
      // Get usage metadata if available
      const usageMetadata = response.usageMetadata || {};
      const promptTokens = usageMetadata.promptTokenCount || 0;
      const totalTokens = usageMetadata.totalTokenCount || 0;
      const completionTokens = totalTokens - promptTokens;
      
      // Construct the structured response
      const adapterResponse: AIAdapterResponse = {
        ...parsedContent,
        rawResponse: response.candidates ? response.candidates[0] : {},
        modelName: this.modelName,
        tokenCount: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens
        }
      };
      
      // Log processing time
      const processingTime = Date.now() - this.processingStart;
      console.log(`[GEMINI] Processed multimodal completion in ${processingTime}ms (${totalTokens} tokens)`);
      
      return adapterResponse;
    } catch (error) {
      const processingTime = Date.now() - this.processingStart;
      console.error(`[GEMINI] Error processing multimodal completion (${processingTime}ms):`, error);
      throw error;
    }
  }
}

/**
 * Helper function to prune JSON schema for Gemini
 * Removes unsupported features that the Gemini API doesn't handle
 */
function pruneGeminiSchema(schema: any): any {
  // Make a deep copy to avoid modifying the original
  const prunedSchema = JSON.parse(JSON.stringify(schema));
  
  // Remove unsupported keys (examples, additionalProperties, etc.)
  const unsupportedKeys = ['examples', 'additionalProperties', 'default', 'pattern'];
  const pruneObject = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    
    // Remove unsupported keys
    for (const key of unsupportedKeys) {
      if (key in obj) delete obj[key];
    }
    
    // Process nested properties
    if (obj.properties) {
      for (const prop in obj.properties) {
        pruneObject(obj.properties[prop]);
      }
    }
    
    // Process array items
    if (obj.items) {
      pruneObject(obj.items);
    }
  };
  
  pruneObject(prunedSchema);
  return prunedSchema;
}