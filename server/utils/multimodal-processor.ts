/**
 * Utility for processing different types of content for multimodal AI processing
 */
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import fetch from 'node-fetch';
import { MultimodalPromptPart } from '../adapters/ai-adapter';
import { 
  getContentTypeFromMimeType, 
  getMimeTypeFromExtension,
  isCSVFile,
  getExtensionFromFilename,
  ContentType
} from './file-type-settings';
import os from 'os';
import crypto from 'crypto';

const readFileAsync = promisify(fs.readFile);
const existsAsync = promisify(fs.exists);
const unlinkAsync = promisify(fs.unlink);
const writeFileAsync = promisify(fs.writeFile);

/**
 * Interface for file metadata
 */
export interface FileMetadata {
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  contentType: ContentType;
  assignmentId?: number;
  userId?: number;
}

/**
 * Extract text content from various document types
 * Currently handles text files and CSV directly
 * More complex document types would require external libraries
 * @param filePath Path to the file
 * @param mimeType MIME type of the file
 */
export async function extractTextContent(
  filePath: string, 
  mimeType: string,
  extension?: string
): Promise<string | undefined> {
  try {
    // Check if file exists
    const fileExists = await existsAsync(filePath);
    if (!fileExists) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    // Handle based on content type
    const contentType = getContentTypeFromMimeType(mimeType);
    
    // For text files, just return the content
    if (contentType === 'text') {
      const content = await readFileAsync(filePath, 'utf8');
      return content;
    }
    
    // Special handling for CSV files
    if (isCSVFile(mimeType, extension || '')) {
      const content = await readFileAsync(filePath, 'utf8');
      // Basic CSV description
      const lines = content.split('\n');
      const headers = lines[0]?.split(',').map(h => h.trim()).filter(Boolean) || [];
      
      let csvDescription = `CSV file with ${lines.length - 1} data rows and ${headers.length} columns.\n`;
      csvDescription += `Headers: ${headers.join(', ')}\n`;
      
      // Include a sample of the data (first 5 rows max)
      csvDescription += `Sample data:\n`;
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        csvDescription += `${lines[i]}\n`;
      }
      
      return csvDescription;
    }
    
    // For other document types, return basic metadata
    return `This is a ${contentType} file with MIME type ${mimeType}. Content processing not available for this file type.`;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error extracting text content: ${errorMessage}`);
    return undefined;
  }
}

/**
 * Create multimodal prompt parts from file metadata
 * @param fileMetadata Metadata for the file
 * @param assignmentPrompt Optional assignment-specific prompt
 */
export async function createMultimodalPromptParts(
  fileMetadata: FileMetadata,
  assignmentPrompt?: string
): Promise<MultimodalPromptPart[]> {
  const parts: MultimodalPromptPart[] = [];
  
  try {
    // Load file content
    const fileContent = await readFileAsync(fileMetadata.path);
    
    // Base multimodal part with file content
    const filePart: MultimodalPromptPart = {
      type: fileMetadata.contentType,
      content: fileContent,
      mimeType: fileMetadata.mimeType
    };
    
    // For document and text types, extract text content when possible
    if (fileMetadata.contentType === 'document' || fileMetadata.contentType === 'text') {
      const extractedText = await extractTextContent(
        fileMetadata.path, 
        fileMetadata.mimeType,
        fileMetadata.originalName
      );
      
      if (extractedText) {
        filePart.textContent = extractedText;
      }
    }
    
    // Add the file part first
    parts.push(filePart);
    
    // Add assignment prompt if provided
    if (assignmentPrompt) {
      parts.push({
        type: 'text' as ContentType,
        content: assignmentPrompt
      });
    }
    
    return parts;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error creating multimodal prompt parts: ${errorMessage}`);
    
    // Fallback to text-only if file processing fails
    return [
      {
        type: 'text' as ContentType,
        content: `Failed to process ${fileMetadata.contentType} file: ${fileMetadata.originalName}. ${errorMessage}`
      },
      ...(assignmentPrompt ? [{
        type: 'text' as ContentType,
        content: assignmentPrompt
      }] : [])
    ];
  }
}

/**
 * Create file metadata from uploaded file
 * @param file The uploaded file object from multer
 */
export function createFileMetadata(file: Express.Multer.File): FileMetadata {
  // Determine MIME type (use the detected one or fallback to extension)
  const mimeType = file.mimetype || getMimeTypeFromExtension(getExtensionFromFilename(file.originalname));
  
  // Determine content type category
  const contentType = getContentTypeFromMimeType(mimeType);
  
  return {
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimeType,
    contentType
  };
}

/**
 * Clean up file resources
 * @param filePath Path to the file to delete
 */
export async function cleanupFile(filePath: string): Promise<void> {
  try {
    if (filePath && fs.existsSync(filePath)) {
      await unlinkAsync(filePath);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error cleaning up file ${filePath}: ${errorMessage}`);
  }
}

/**
 * Batch cleanup multiple files
 * @param filePaths Array of file paths to delete
 */
export async function cleanupFiles(filePaths: string[]): Promise<void> {
  const cleanupPromises = filePaths.map(path => cleanupFile(path));
  await Promise.allSettled(cleanupPromises);
}

/**
 * Convert a file buffer to a data URI
 * @param content Buffer containing file data
 * @param mimeType MIME type of the file
 * @returns Base64 encoded data URI string
 */
export function fileToDataURI(content: Buffer, mimeType: string): string {
  const base64 = content.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Check if a path is a remote URL or a GCS object path
 * @param path Path to check
 * @returns Boolean indicating if the path is a remote URL or GCS path
 */
export function isRemoteUrl(path: string): boolean {
  if (!path) {
    console.log('[MULTIMODAL] Empty path provided to isRemoteUrl');
    return false;
  }
  
  console.log(`[MULTIMODAL] Checking if path is remote URL: ${path.substring(0, 30)}${path.length > 30 ? '...' : ''}`);
  
  try {
    // Check if it's a valid URL first
    try {
      // This will throw if the URL is invalid
      new URL(path);
      console.log('[MULTIMODAL] Path is a valid URL with protocol');
      return true;
    } catch (e) {
      // Not a valid URL with protocol - continue checks
    }
    
    // First, check for standard URL protocols
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('gs://')) {
      console.log('[MULTIMODAL] Path is definitely a remote URL (has protocol)');
      return true;
    }
    
    // Check for GCS storage.googleapis.com URLs
    if (path.includes('storage.googleapis.com') || path.includes('googleusercontent.com')) {
      console.log('[MULTIMODAL] Path is a GCS URL (storage.googleapis.com or googleusercontent.com)');
      return true;
    }
    
    // Check for potential GCS object paths that should be converted to signed URLs
    // Logic fix: proper grouping of conditions with parentheses to avoid incorrect evaluation
    const isPotentialGcsPath = 
      path.startsWith('/') === false && // Not an absolute local path
      path.includes('/') && // Has at least one folder separator
      !path.includes('\\') && // Not a Windows-style path
      (path.startsWith('submissions/') || path.startsWith('anonymous-submissions/')); // Specific GCS path patterns
    
    if (isPotentialGcsPath) {
      console.log('[MULTIMODAL] Path is a GCS object path (matches submission pattern)');
      return true;
    }
    
    // If the file doesn't exist locally but has path separators, it's likely a remote path
    const hasPathSeparators = path.includes('/');
    const fileExistsLocally = fs.existsSync(path);
    
    if (hasPathSeparators && !fileExistsLocally) {
      console.log('[MULTIMODAL] Path contains separators but file not found locally - treating as remote');
      return true;
    }
    
    console.log('[MULTIMODAL] Path appears to be a local file path');
    return false;
  } catch (error) {
    console.error('[MULTIMODAL] Error in isRemoteUrl check:', error);
    // Default to treating it as remote if we can't determine
    return true;
  }
}

/**
 * Download a file from a remote URL (GCS, HTTP, HTTPS) 
 * @param url The URL to download from
 * @param mimeType Optional MIME type of the file (useful for GCS URLs that might not provide Content-Type)
 * @returns An object containing the file buffer and temporary local path
 */
export async function downloadFromUrl(url: string, mimeType?: string): Promise<{ 
  buffer: Buffer, 
  localPath: string,
  cleanup: () => Promise<void>
}> {
  try {
    console.log(`[DOWNLOAD] Downloading file from URL: ${url.substring(0, 30)}... (url length: ${url.length})`);
    
    // Generate a temporary file path
    const tempDir = os.tmpdir();
    const randomName = crypto.randomBytes(16).toString('hex');
    const extension = mimeType ? 
      `.${mimeType.split('/')[1]}` : 
      path.extname(url) || '.tmp';
    
    const localPath = path.join(tempDir, `${randomName}${extension}`);
    console.log(`[DOWNLOAD] Using temp file path: ${localPath}`);
    
    // Handle different URL types
    let fileBuffer: Buffer;
    
    if (url.startsWith('gs://')) {
      // For direct GCS URLs, we need to use the Google Cloud Storage SDK
      console.log(`[DOWNLOAD] Detected GCS URL (gs:// protocol): ${url}`);
      try {
        // Import the GCS client only when needed
        const gcsClient = require('./gcs-client');
        const { getBucket, bucketName, generateSignedUrl, isGcsConfigured } = gcsClient;
        
        // Verify GCS is configured before proceeding
        if (!isGcsConfigured()) {
          throw new Error('GCS not configured. Check GOOGLE_APPLICATION_CREDENTIALS and GCS_BUCKET_NAME environment variables.');
        }
        
        // Parse the GCS URL (format: gs://bucket-name/path/to/file)
        const gcsPath = url.replace('gs://', '');
        const [bucketFromUrl, ...objectPathParts] = gcsPath.split('/');
        
        // Validate that we have a non-empty object path
        if (!objectPathParts || objectPathParts.length === 0) {
          throw new Error(`Invalid GCS URL format: ${url}. Expected format: gs://bucket-name/path/to/file`);
        }
        
        const objectPath = objectPathParts.join('/');
        
        // Determine which bucket to use (from URL or default)
        const targetBucket = bucketFromUrl || bucketName;
        if (!targetBucket) {
          throw new Error('No bucket specified in GCS URL and no default bucket configured');
        }
        
        console.log(`[DOWNLOAD] GCS bucket: ${targetBucket}, object path: ${objectPath}`);
        
        // Try two approaches:
        // 1. First, attempt to get a signed URL and use HTTP fetch (more reliable for large files)
        // 2. If that fails, fall back to direct download
        try {
          console.log(`[DOWNLOAD] Attempting to get signed URL for GCS object`);
          const signedUrl = await generateSignedUrl(objectPath, 60); // 60 minutes expiration
          
          console.log(`[DOWNLOAD] Successfully got signed URL, downloading via HTTP`);
          const response = await fetch(signedUrl);
          
          if (!response.ok) {
            throw new Error(`Failed to download from signed URL: ${response.status} ${response.statusText}`);
          }
          
          const arrayBuffer = await response.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
          console.log(`[DOWNLOAD] Successfully downloaded from GCS signed URL, file size: ${fileBuffer.length} bytes`);
        } catch (error) { 
          const signedUrlError = error as Error;
          console.warn(`[DOWNLOAD] Failed to use signed URL approach: ${signedUrlError.message}, falling back to direct download`);
          
          // Get the bucket and file objects for direct download
          const bucket = getBucket(targetBucket);
          const file = bucket.file(objectPath);
          
          // Download the file to a buffer
          console.log(`[DOWNLOAD] Downloading directly from GCS bucket: ${targetBucket}, object: ${objectPath}`);
          const [fileData] = await file.download();
          fileBuffer = fileData;
          console.log(`[DOWNLOAD] Successfully downloaded directly from GCS, file size: ${fileBuffer.length} bytes`);
        }
        
        // Write to temp file for operations that need a file path
        await writeFileAsync(localPath, fileBuffer);
        console.log(`[DOWNLOAD] Wrote GCS file data to temporary path: ${localPath}`);
      } catch (gcsError) {
        console.error('[DOWNLOAD] Error downloading from GCS:', gcsError);
        throw new Error(`Failed to download file from GCS: ${gcsError instanceof Error ? gcsError.message : String(gcsError)}`);
      }
    } else {
      // Standard HTTP/HTTPS URLs (including GCS signed URLs)
      console.log(`[DOWNLOAD] Standard HTTP URL detected, using fetch`);
      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          console.error(`[DOWNLOAD] Fetch request failed with status: ${response.status}`);
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }
        
        // Get content type from response if not provided
        const responseContentType = response.headers.get('content-type');
        if (!mimeType && responseContentType) {
          mimeType = responseContentType;
          console.log(`[DOWNLOAD] Got content type from response: ${mimeType}`);
        }
        
        // Get the file buffer
        const arrayBuffer = await response.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        console.log(`[DOWNLOAD] Successfully downloaded via HTTP, file size: ${fileBuffer.length} bytes`);
        
        // Write to temp file for operations that need a file path
        await writeFileAsync(localPath, fileBuffer);
        console.log(`[DOWNLOAD] Wrote HTTP file data to temporary path: ${localPath}`);
      } catch (fetchError) {
        console.error('[DOWNLOAD] Error fetching from URL:', fetchError);
        throw new Error(`Failed to download file: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }
    }
    
    // Return file buffer and local path
    return { 
      buffer: fileBuffer, 
      localPath,
      // Function to clean up the temporary file
      cleanup: async () => {
        try {
          if (fs.existsSync(localPath)) {
            await unlinkAsync(localPath);
          }
        } catch (error) {
          console.warn(`Failed to clean up temporary file ${localPath}:`, error);
        }
      }
    };
  } catch (error) {
    console.error('Error downloading file from URL:', error);
    throw error;
  }
}

/**
 * Interface representing a processed file for multimodal content
 */
export interface ProcessedFile {
  content: Buffer | string;
  contentType: ContentType;
  textContent?: string;
  mimeType: string;
}

/**
 * Process a file for multimodal AI analysis
 * @param filePath Path to the file or URL to download from
 * @param fileName Original name of the file
 * @param mimeType MIME type of the file
 * @returns ProcessedFile object containing the file content and metadata
 */
export async function processFileForMultimodal(
  filePath: string,
  fileName: string, 
  mimeType: string
): Promise<ProcessedFile> {
  // Validate input
  if (!filePath || filePath.trim() === '') {
    throw new Error('Invalid file path: Path is empty or undefined');
  }
  
  console.log(`[MULTIMODAL] Processing file for multimodal analysis:`, {
    fileName,
    mimeType,
    filePathLength: filePath.length,
    // For debugging purposes, show part of the path without exposing the full URL
    filePathStart: filePath.substring(0, 30) + '...',
    isGcsPath: filePath.startsWith('submissions/') || filePath.startsWith('anonymous-submissions/'),
    isSignedUrl: filePath.includes('storage.googleapis.com') && filePath.includes('Signature='),
    imageType: mimeType.startsWith('image/') ? mimeType : 'not-image'
  });
  
  let temporaryFilePath: string | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  try {
    // Check if the file path is a remote URL, GCS path, or a local path
    let fileContent: Buffer;
    let actualFilePath = filePath;
    
    // Handle GCS path that's not yet converted to a URL
    if ((filePath.startsWith('submissions/') || filePath.startsWith('anonymous-submissions/')) && 
        !filePath.startsWith('http')) {
      
      console.log(`[MULTIMODAL] File path is a GCS object path: ${filePath}`);
      
      try {
        // Dynamically import GCS client to handle dependencies
        const gcsClient = require('./gcs-client');
        const { generateSignedUrl, isGcsConfigured, getBucket, bucketName } = gcsClient;
        
        // Check if GCS credentials are available
        if (isGcsConfigured()) {
          try {
            console.log(`[MULTIMODAL] GCS configured, generating signed URL for path: ${filePath}`);
            
            // First try: Generate a signed URL with 60-minute expiration
            const signedUrl = await generateSignedUrl(filePath, 60);
            
            if (signedUrl && signedUrl.startsWith('http')) {
              console.log(`[MULTIMODAL] Successfully generated signed URL (${signedUrl.length} chars)`);
              // Update the file path to use the signed URL
              filePath = signedUrl;
            } else {
              console.warn(`[MULTIMODAL] Generated URL was invalid: ${signedUrl ? signedUrl.substring(0, 30) + '...' : 'undefined'}`);
              throw new Error('Invalid signed URL generated');
            }
          } catch (signedUrlError) {
            console.warn(`[MULTIMODAL] Could not generate signed URL, attempting direct GCS access:`, signedUrlError);
            
            // Second try: Direct download with GCS SDK
            try {
              console.log(`[MULTIMODAL] Attempting direct GCS access for: ${filePath}`);
              // Prepare for direct GCS download in downloadFromUrl by converting to gs:// URL format
              filePath = `gs://${bucketName}/${filePath}`;
              console.log(`[MULTIMODAL] Converted to GCS URI format: ${filePath}`);
            } catch (conversionError) {
              console.error(`[MULTIMODAL] Error during GCS path conversion:`, conversionError);
              // Keep the original path as is
            }
          }
        } else {
          console.warn(`[MULTIMODAL] GCS not configured. Check GOOGLE_APPLICATION_CREDENTIALS and GCS_BUCKET_NAME environment variables.`);
          // If GCS is not configured, we need to check if the necessary environment variables exist
          console.log(`[MULTIMODAL] Checking for GCS credentials: GOOGLE_APPLICATION_CREDENTIALS ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'exists' : 'missing'}, GCS_BUCKET_NAME ${process.env.GCS_BUCKET_NAME ? 'exists' : 'missing'}`);
        }
      } catch (gcsError) {
        console.error(`[MULTIMODAL] GCS client error:`, gcsError);
        // Don't throw here, let downloadFromUrl try to handle the path
      }
    }

    if (isRemoteUrl(filePath)) {
      // Download from remote URL (HTTP/HTTPS, GCS)
      console.log(`[MULTIMODAL] File path is a remote URL, attempting to download`);
      try {
        const result = await downloadFromUrl(filePath, mimeType);
        fileContent = result.buffer;
        actualFilePath = result.localPath;
        temporaryFilePath = result.localPath;
        cleanup = result.cleanup;
        console.log(`[MULTIMODAL] Successfully downloaded file from remote URL, size: ${fileContent.length} bytes`);
      } catch (downloadError: any) {
        console.error(`[MULTIMODAL] Error downloading from URL:`, downloadError);
        throw new Error(`Failed to download file from URL: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
      }
    } else {
      // Read from local file path
      console.log(`[MULTIMODAL] File path is a local path, reading from filesystem`);
      try {
        // Check if the file exists first
        const exists = await existsAsync(filePath);
        if (!exists) {
          console.error(`[MULTIMODAL] File does not exist at path: ${filePath}`);
          throw new Error(`File does not exist at path: ${filePath}`);
        }
        
        fileContent = await fs.promises.readFile(filePath);
        console.log(`[MULTIMODAL] Successfully read local file, size: ${fileContent.length} bytes`);
      } catch (readError) {
        console.error(`[MULTIMODAL] Error reading local file:`, readError);
        throw new Error(`Failed to read local file: ${readError instanceof Error ? readError.message : String(readError)}`);
      }
    }
    
    // Determine content type from the mime type and filename
    const contentType = getContentTypeFromMimeType(mimeType);
    console.log(`[MULTIMODAL] Determined content type: ${contentType} from MIME type: ${mimeType}`);
    
    // For text and document types, attempt to extract text content
    let textContent: string | undefined;
    if (contentType === 'text' || contentType === 'document') {
      try {
        // The filename extension might be needed for some document types
        const extension = path.extname(fileName).toLowerCase();
        console.log(`[MULTIMODAL] Attempting to extract text content from ${contentType} file with extension: ${extension}`);
        textContent = await extractTextContent(actualFilePath, mimeType, extension);
        console.log(`[MULTIMODAL] Successfully extracted text content, length: ${textContent?.length || 0} characters`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[MULTIMODAL] Failed to extract text from ${fileName}: ${errorMessage}`);
        // Continue with the process even if text extraction fails
      }
    }
    
    // Special handling for images - validate they're actually valid images
    if (contentType === 'image') {
      try {
        console.log(`[MULTIMODAL] Validating image data, size: ${fileContent.length} bytes, MIME type: ${mimeType}`);
        
        // Check if the file has the proper image header bytes based on format
        const isValidImage = ((): boolean => {
          if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            // JPEG starts with bytes FF D8
            return fileContent.length >= 2 && 
                  fileContent[0] === 0xFF && 
                  fileContent[1] === 0xD8;
          } else if (mimeType === 'image/png') {
            // PNG starts with the bytes 89 50 4E 47 0D 0A 1A 0A
            return fileContent.length >= 8 && 
                  fileContent[0] === 0x89 && 
                  fileContent[1] === 0x50 &&
                  fileContent[2] === 0x4E &&
                  fileContent[3] === 0x47 &&
                  fileContent[4] === 0x0D &&
                  fileContent[5] === 0x0A &&
                  fileContent[6] === 0x1A &&
                  fileContent[7] === 0x0A;
          } else if (mimeType === 'image/gif') {
            // GIF starts with "GIF87a" or "GIF89a"
            return fileContent.length >= 6 && 
                  fileContent[0] === 0x47 && // G
                  fileContent[1] === 0x49 && // I
                  fileContent[2] === 0x46;   // F
          } else if (mimeType === 'image/webp') {
            // WebP starts with "RIFF" followed by file size and "WEBP"
            return fileContent.length >= 12 && 
                  fileContent[0] === 0x52 && // R
                  fileContent[1] === 0x49 && // I
                  fileContent[2] === 0x46 && // F
                  fileContent[3] === 0x46 && // F
                  // Skip 4 bytes for file size
                  fileContent[8] === 0x57 && // W
                  fileContent[9] === 0x45 && // E
                  fileContent[10] === 0x42 && // B
                  fileContent[11] === 0x50;  // P
          }
          // For other image types, just check if there's actual data
          return fileContent.length > 100; // Arbitrary minimum size
        })();
        
        if (!isValidImage) {
          console.warn('[MULTIMODAL] Warning: Image data appears to be invalid or corrupted');
        } else {
          console.log('[MULTIMODAL] Image validation successful');
        }
        
        // If the image content is too large for inline data, log a warning
        if (fileContent.length > 4 * 1024 * 1024) { // 4MB 
          console.warn(`[MULTIMODAL] Image file is large (${Math.round(fileContent.length / 1024 / 1024)}MB), which may cause issues with AI processing`);
        }
      } catch (imageValidationError) {
        console.warn('[MULTIMODAL] Error validating image:', imageValidationError);
      }
    }
    
    console.log(`[MULTIMODAL] Successfully processed file for analysis, returning result`);
    // Return the processed file
    return {
      content: fileContent,
      contentType,
      textContent,
      mimeType
    };
  } catch (error: unknown) {
    console.error(`Error processing file ${fileName} for multimodal analysis:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to process file for multimodal analysis: ${errorMessage}`);
  } finally {
    // Clean up any temporary files
    if (cleanup) {
      try {
        await cleanup();
      } catch (cleanupError) {
        console.warn('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
}