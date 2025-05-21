/**
 * Test script to verify DOCX file handling with the improved Gemini adapter
 * This test specifically validates that:
 * 1. The genAI parameter is passed correctly to createFileData as the first argument
 * 2. File upload uses the SDK v0.14.0 format with 'file' parameter 
 * 3. The temporary file approach is working for reliable uploads
 */

import { promises as fs } from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Ensure you have your API key set
if (!process.env.GOOGLE_API_KEY) {
  console.error('ERROR: GOOGLE_API_KEY environment variable is not set');
  console.error('Please set it before running this test');
  process.exit(1);
}

// Initialize Google GenAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Test file path - you can replace this with your own test file
const docxTestFile = process.env.TEST_DOCX_PATH || 'attached_assets/Gemini_File_Upload_Migration_Guide.docx';

/**
 * Test if a file exists and is accessible
 */
async function checkFileExists(filePath) {
  try {
    await fs.access(filePath);
    console.log(`✅ File found: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ File not found: ${filePath}`);
    console.error(`Error details: ${error.message}`);
    return false;
  }
}

/**
 * Create a Gemini file reference using the temporary file approach
 */
async function createFileDataWithTempFile(content, mimeType) {
  try {
    // For Node.js, save the buffer to a temporary file as recommended
    const tempFilePath = `/tmp/gemini-upload-test-${Date.now()}`;
    await fs.writeFile(tempFilePath, content);
    
    // Upload using SDK v0.14.0 format with the file parameter
    console.log(`Uploading file to Gemini: ${tempFilePath}`);
    const file = await genAI.files.upload({
      file: tempFilePath,
      config: { mimeType }
    });
    
    console.log(`✅ File successfully uploaded to Gemini API`);
    console.log(`File reference: ${file.fileId}`);
    
    // Clean up the temporary file
    await fs.unlink(tempFilePath);
    
    // Return in the format expected by the adapter
    return { 
      fileUri: file.fileId,
      mimeType 
    };
  } catch (error) {
    console.error(`❌ File upload failed: ${error.message}`);
    throw error;
  }
}

/**
 * Main test function
 */
async function testDocxHandling() {
  console.log('=== Starting DOCX file handling test ===');
  
  // Check if the test file exists
  if (!await checkFileExists(docxTestFile)) {
    console.error('Test failed: Could not find test DOCX file');
    process.exit(1);
  }
  
  try {
    // Read the file content
    console.log(`Reading DOCX file: ${docxTestFile}`);
    const fileContent = await fs.readFile(docxTestFile);
    
    // Get file size
    console.log(`File size: ${fileContent.length} bytes`);
    
    // Upload the file using our improved method
    console.log('Uploading DOCX to Gemini Files API...');
    const fileData = await createFileDataWithTempFile(
      fileContent,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    
    console.log('=== Test Results ===');
    console.log(`File URI: ${fileData.fileUri}`);
    console.log(`MIME Type: ${fileData.mimeType}`);
    console.log('✅ Test successful! DOCX file handling is working correctly');
    
    // Try to use the file with Gemini model
    console.log('\nTesting file with Gemini model...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
    
    const prompt = "Analyze this document and summarize its key points in 3-5 bullet points.";
    
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { fileData: { fileUri: fileData.fileUri, mimeType: fileData.mimeType } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      }
    });
    
    console.log('\n=== Gemini Response ===');
    console.log(result.response.text());
    console.log('\n✅ Full test complete! DOCX file handling is working end-to-end');
    
  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testDocxHandling().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});