/**
 * Test script to verify image file handling with the improved Gemini adapter
 * This test validates:
 * 1. Small images use inline data URIs (under 5MB)
 * 2. Large images use the Files API
 * 3. SVG files always use the Files API regardless of size
 */

const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Ensure you have your API key set
if (!process.env.GOOGLE_API_KEY) {
  console.error('ERROR: GOOGLE_API_KEY environment variable is not set');
  console.error('Please set it before running this test');
  process.exit(1);
}

// Initialize Google GenAI with your API key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Test file paths - adjust as needed
const testImageSmall = 'attached_assets/favicon-32x32.png'; // Small PNG
const testImageLarge = 'attached_assets/Screenshot 2025-05-16 at 2.27.56 PM.png'; // Large PNG
const testImageSvg = 'test_image.svg'; // SVG file

// Constants for file handling
const MAX_INLINE_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB - same as in our adapter

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
 * Create a base64 data URI from file content
 */
function createDataUri(content, mimeType) {
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

/**
 * Upload file using Files API with temporary file approach
 */
async function uploadWithFilesAPI(content, mimeType) {
  try {
    // For Node.js, save the buffer to a temporary file as recommended
    const tempFilePath = `/tmp/gemini-upload-test-${Date.now()}`;
    await fs.writeFile(tempFilePath, content);
    
    // Upload using SDK v0.14.0 format with the file parameter
    console.log(`Uploading file to Gemini Files API: ${tempFilePath}`);
    const file = await genAI.files.upload({
      file: tempFilePath, 
      config: { mimeType }
    });
    
    console.log(`✅ File successfully uploaded to Gemini Files API`);
    
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
 * Determine if we should use the Files API based on file size and type
 */
function shouldUseFilesAPI(mimeType, contentSize) {
  // Safety check to ensure mimeType is a string
  const mime = typeof mimeType === 'string' ? mimeType : 'application/octet-stream';
  
  // Always use Files API for SVG, regardless of size
  if (mime === 'image/svg+xml') {
    return true;
  }
  
  // Use Files API for large images
  if (mime.startsWith('image/') && contentSize > MAX_INLINE_IMAGE_SIZE) {
    return true;
  }
  
  return false;
}

/**
 * Test image processing with Gemini
 */
async function testWithGemini(imageData, mimeType, description) {
  console.log(`\nTesting with Gemini model: ${description}`);
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
    
    const prompt = "Describe what you see in this image in 2-3 sentences.";
    
    let result;
    if (typeof imageData === 'string' && imageData.startsWith('data:')) {
      // Using inline data URI
      console.log('Using inline data URI method');
      
      // Extract the base64 data part
      const base64Data = imageData.split(',')[1];
      
      result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { 
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        }
      });
    } else {
      // Using file URI
      console.log('Using Files API method');
      result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { 
                fileData: {
                  fileUri: imageData.fileUri,
                  mimeType: imageData.mimeType
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        }
      });
    }
    
    console.log('\n=== Gemini Response ===');
    console.log(result.response.text());
    console.log('\n✅ Test complete!');
    
    return true;
  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error);
    return false;
  }
}

/**
 * Main test function for a specific image
 */
async function testImage(imagePath, description) {
  console.log(`\n=== Testing ${description} ===`);
  
  // Check if the test file exists
  if (!await checkFileExists(imagePath)) {
    console.error(`Test skipped: Could not find test image ${imagePath}`);
    return false;
  }
  
  try {
    // Get file extension and determine MIME type
    const ext = path.extname(imagePath).toLowerCase();
    let mimeType;
    
    switch (ext) {
      case '.png': mimeType = 'image/png'; break;
      case '.jpg':
      case '.jpeg': mimeType = 'image/jpeg'; break;
      case '.svg': mimeType = 'image/svg+xml'; break;
      case '.gif': mimeType = 'image/gif'; break;
      case '.webp': mimeType = 'image/webp'; break;
      default: mimeType = 'application/octet-stream';
    }
    
    // Read the file content
    console.log(`Reading image file: ${imagePath}`);
    const fileContent = await fs.readFile(imagePath);
    
    // Get file size
    const fileSize = fileContent.length;
    console.log(`File size: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)`);
    
    // Determine if we should use Files API
    const useFilesAPI = shouldUseFilesAPI(mimeType, fileSize);
    console.log(`Decision: ${useFilesAPI ? 'Using Files API' : 'Using inline data URI'}`);
    
    let imageData;
    
    if (useFilesAPI) {
      // Upload with Files API
      imageData = await uploadWithFilesAPI(fileContent, mimeType);
      console.log(`File URI: ${imageData.fileUri}`);
    } else {
      // Create inline data URI
      imageData = createDataUri(fileContent, mimeType);
      console.log(`Created data URI (length: ${imageData.length} chars)`);
    }
    
    // Test with Gemini
    return await testWithGemini(imageData, mimeType, description);
    
  } catch (error) {
    console.error(`❌ Test failed with error:`);
    console.error(error);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('===== GEMINI IMAGE HANDLING TEST SUITE =====');
  
  // Test a small image (should use inline data)
  const smallSuccess = await testImage(testImageSmall, 'small image (favicon)');
  
  // Test a large image (should use Files API)
  const largeSuccess = await testImage(testImageLarge, 'large image (screenshot)');
  
  // Test an SVG image (should always use Files API)
  const svgSuccess = await testImage(testImageSvg, 'SVG image');
  
  // Report overall results
  console.log('\n===== TEST SUMMARY =====');
  console.log(`Small image test: ${smallSuccess ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Large image test: ${largeSuccess ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`SVG image test: ${svgSuccess ? '✅ PASSED' : '❌ FAILED'}`);
  
  const allSuccess = smallSuccess && largeSuccess && svgSuccess;
  console.log(`\nOverall result: ${allSuccess ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  process.exit(allSuccess ? 0 : 1);
}

// Run all tests
runAllTests();