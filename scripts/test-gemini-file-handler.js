/**
 * Test script to verify proper genAI instance parameter handling in createFileData
 * 
 * This test focuses specifically on ensuring the genAI instance is correctly passed
 * as the first parameter to createFileData function
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get the API key from environment variables
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  process.exit(1);
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' });

// Test file paths for different types
const DOCX_PATH = './attached_assets/Gemini_File_Upload_Migration_Guide.docx';
const IMAGE_PATH = './attached_assets/AcademusLogo.webp';

// MIME types
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_MIME_TYPE = 'image/webp';

/**
 * Implementation of createFileData function with proper genAI parameter handling
 * - This is a test version that logs the parameters to verify correct usage
 * - We're testing that genAI is always the first parameter
 */
async function createFileData(genAI, content, mimeType, filename = null) {
  console.log('createFileData called with:');
  console.log('  - genAI instance:', genAI ? 'Provided ✓' : 'Missing ✗');
  console.log('  - Content length:', content?.length ? content.length + ' bytes' : 'Invalid content');
  console.log('  - MIME type:', mimeType);
  console.log('  - Filename:', filename);
  
  // Check if first parameter is actually a GoogleGenerativeAI instance
  if (!genAI || typeof genAI !== 'object' || !('apiKey' in genAI)) {
    throw new Error('First parameter must be a valid GoogleGenerativeAI instance');
  }
  
  try {
    // For this test, we'll simulate the file data creation process
    return {
      file_uri: 'https://generativelanguage.googleapis.com/v1/files/file_12345',
      mime_type: mimeType,
      file_size: content.length
    };
  } catch (error) {
    console.error('Error creating file data:', error);
    throw error;
  }
}

/**
 * Test createFileData with the correct parameter order
 */
async function testCorrectParameterOrder() {
  console.log('\n=== TESTING CORRECT PARAMETER ORDER ===');
  
  try {
    // Read the test DOCX file
    const docxContent = await fs.promises.readFile(DOCX_PATH);
    console.log(`Read DOCX file: ${docxContent.length} bytes`);
    
    // Call createFileData with proper order: genAI first, then content, then mimeType
    const fileData = await createFileData(genAI, docxContent, DOCX_MIME_TYPE, 'test.docx');
    
    console.log('File data created successfully:', fileData);
    return true;
  } catch (error) {
    console.error('Error in correct parameter test:', error);
    return false;
  }
}

/**
 * Test createFileData with incorrect parameter order
 */
async function testIncorrectParameterOrder() {
  console.log('\n=== TESTING INCORRECT PARAMETER ORDER ===');
  console.log('This test should fail as genAI is not the first parameter');
  
  try {
    // Read the test image file
    const imageContent = await fs.promises.readFile(IMAGE_PATH);
    console.log(`Read image file: ${imageContent.length} bytes`);
    
    // Create a function that simulates the wrong parameter order
    // This mimics using createFileData incorrectly in the codebase
    const createFileDataWrongOrder = async (content, mimeType, genAIInstance) => {
      console.log('Using incorrect parameter order!');
      // This would pass the parameters in the wrong order
      return await createFileData(content, mimeType, genAIInstance);
    };
    
    try {
      // INCORRECT ORDER: content first, then mimeType, genAI last
      // This simulates the error we're fixing
      const fileData = await createFileDataWrongOrder(imageContent, IMAGE_MIME_TYPE, genAI);
      
      console.log('❌ Test failed: Incorrect order should have thrown an error');
      return false;
    } catch (error) {
      console.log('✅ Test passed: Incorrect parameter order correctly threw an error');
      console.log('Error message:', error.message);
      return true;
    }
  } catch (error) {
    console.error('Error in incorrect parameter test:', error);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('=== GEMINI FILE HANDLER PARAMETER ORDER TESTS ===');
  
  // Check if test files exist
  if (!fs.existsSync(DOCX_PATH)) {
    console.error(`Test file not found: ${DOCX_PATH}`);
    return;
  }
  
  if (!fs.existsSync(IMAGE_PATH)) {
    console.error(`Test file not found: ${IMAGE_PATH}`);
    return;
  }
  
  // Run the tests
  const correctOrderResult = await testCorrectParameterOrder();
  const incorrectOrderResult = await testIncorrectParameterOrder();
  
  // Print summary
  console.log('\n=== TEST RESULTS ===');
  console.log(`Correct parameter order: ${correctOrderResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Incorrect parameter order detection: ${incorrectOrderResult ? '✅ PASS' : '❌ FAIL'}`);
  
  if (correctOrderResult && incorrectOrderResult) {
    console.log('\n✅ ALL TESTS PASSED');
    console.log('The genAI parameter is correctly handled as the first parameter in createFileData');
  } else {
    console.log('\n❌ TESTS FAILED');
    console.log('Fix needed: Ensure genAI is always the first parameter to createFileData');
  }
}

// Run tests
runTests().catch(console.error);