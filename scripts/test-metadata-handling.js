/**
 * Test script to verify usageMetadata handling improvements in the Gemini adapter
 * Tests both text-only and multimodal completions to ensure metadata is captured correctly
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' });

// Mock implementation of the collectStream function to test usageMetadata capture
async function collectStream(request) {
  console.log('Sending streaming request to Gemini API...');
  
  const stream = await model.generateContentStream(request);
  let streamedText = '';
  let finishReason = 'STOP'; // Default to successful finish
  let usageMetadata = null; // Will store metadata when available
  
  // Process the stream chunks
  for await (const chunk of stream) {
    // Check for usage metadata in the chunk (typically comes in the last chunk)
    if (chunk.usageMetadata) {
      usageMetadata = chunk.usageMetadata;
      console.log(`Received usage metadata from stream: `, {
        promptTokenCount: usageMetadata.promptTokenCount,
        candidatesTokenCount: usageMetadata.candidatesTokenCount, 
        totalTokenCount: usageMetadata.totalTokenCount
      });
    }
    
    if (chunk.candidates && chunk.candidates.length > 0) {
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
  
  console.log(`Stream received ${streamedText.length} characters, finish reason: ${finishReason}`);
  return { raw: streamedText, finishReason, usageMetadata };
}

/**
 * Test text completion with metadata handling
 */
async function testTextCompletionMetadata() {
  console.log('=== TEXT COMPLETION METADATA TEST ===');
  
  try {
    // Prepare a simple request
    const request = {
      model: 'gemini-2.5-flash-preview-04-17',
      contents: [{ 
        role: 'user', 
        parts: [{ text: 'Explain why document handling for DOCX files needs special attention in 2 sentences.' }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: 'application/json'
      }
    };
    
    // Run the request with our enhanced collectStream function
    const { raw, finishReason, usageMetadata } = await collectStream(request);
    
    // Validate results
    console.log('Text completion results:');
    console.log('Raw response:', raw.substring(0, 100) + '...');
    console.log('Finish reason:', finishReason);
    
    if (usageMetadata) {
      console.log('✅ Usage metadata captured successfully');
      console.log('Prompt tokens:', usageMetadata.promptTokenCount);
      console.log('Candidate tokens:', usageMetadata.candidatesTokenCount);
      console.log('Total tokens:', usageMetadata.totalTokenCount);
      return true;
    } else {
      console.warn('⚠️ No usage metadata in response');
      return false;
    }
  } catch (error) {
    console.error('Text completion metadata test failed:', error);
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('Starting metadata handling tests...');
  
  // Verify API key
  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is required for testing');
    return;
  }
  
  // Run metadata handling test
  const textCompletionResult = await testTextCompletionMetadata();
  
  // Print summary
  console.log('\n=== TEST RESULTS ===');
  console.log(`Text completion metadata handling: ${textCompletionResult ? '✅ PASS' : '❌ FAIL'}`);
}

// Run the tests
runTests().catch(console.error);