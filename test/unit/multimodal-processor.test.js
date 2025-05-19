const { describe, it, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Mock modules
jest.mock('node-fetch');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  },
  existsSync: jest.fn(),
}));

// Import functions after mocking
const {
  isRemoteUrl,
  downloadFromUrl,
  processFileForMultimodal
} = require('../../server/utils/multimodal-processor');

describe('Multimodal Processor Utilities', () => {
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Default implementations
    fs.promises.readFile.mockResolvedValue(Buffer.from('test content'));
    fs.promises.writeFile.mockResolvedValue();
    fs.promises.unlink.mockResolvedValue();
    fs.existsSync.mockReturnValue(true);
  });
  
  describe('isRemoteUrl', () => {
    it('should identify HTTP URLs as remote', () => {
      expect(isRemoteUrl('http://example.com/file.pdf')).toBe(true);
    });
    
    it('should identify HTTPS URLs as remote', () => {
      expect(isRemoteUrl('https://example.com/file.pdf')).toBe(true);
    });
    
    it('should identify S3 URLs as remote', () => {
      expect(isRemoteUrl('s3://bucket/file.pdf')).toBe(true);
    });
    
    it('should identify local paths as non-remote', () => {
      expect(isRemoteUrl('/tmp/uploads/file.pdf')).toBe(false);
      expect(isRemoteUrl('C:\\temp\\file.pdf')).toBe(false);
      expect(isRemoteUrl('./relative/path/file.pdf')).toBe(false);
    });
  });
  
  describe('downloadFromUrl', () => {
    it('should download from HTTP URLs and save to temp file', async () => {
      // Setup mock response
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('application/pdf')
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10))
      };
      fetch.mockResolvedValue(mockResponse);
      
      // Call function
      const result = await downloadFromUrl('https://storage.googleapis.com/test-bucket/file.pdf');
      
      // Verify results
      expect(fetch).toHaveBeenCalledWith('https://storage.googleapis.com/test-bucket/file.pdf');
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.localPath).toContain('.pdf');
      expect(typeof result.cleanup).toBe('function');
      
      // Test cleanup function
      await result.cleanup();
      expect(fs.promises.unlink).toHaveBeenCalled();
    });
    
    it('should handle errors from fetch', async () => {
      // Setup mock response for failure
      fetch.mockRejectedValue(new Error('Network error'));
      
      // Verify error handling
      await expect(downloadFromUrl('https://storage.googleapis.com/test-bucket/file.pdf')).rejects.toThrow();
    });
    
    it('should handle HTTP error responses', async () => {
      // Setup mock response
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };
      fetch.mockResolvedValue(mockResponse);

      // Verify error handling
      await expect(downloadFromUrl('https://storage.googleapis.com/test-bucket/file.pdf')).rejects.toThrow('Failed to download file: 404 Not Found');
    });

    it('should reject URLs from disallowed hosts', async () => {
      await expect(downloadFromUrl('https://malicious.com/file.pdf')).rejects.toThrow('Disallowed host');
      expect(fetch).not.toHaveBeenCalled();
    });
  });
  
  describe('processFileForMultimodal', () => {
    it('should process local files', async () => {
      // Call function with local path
      const result = await processFileForMultimodal('/tmp/file.txt', 'file.txt', 'text/plain');
      
      // Verify results
      expect(fs.promises.readFile).toHaveBeenCalledWith('/tmp/file.txt');
      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('text'); // Assuming text is the content type for text/plain
      expect(result.mimeType).toBe('text/plain');
    });
    
    it('should handle remote URLs by downloading them first', async () => {
      // Setup mocks for URL processing
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/jpeg')
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10))
      };
      fetch.mockResolvedValue(mockResponse);
      
      // Call function with URL
      const result = await processFileForMultimodal('https://storage.googleapis.com/test-bucket/image.jpg', 'image.jpg', 'image/jpeg');
      
      // Verify downloads happened
      expect(fetch).toHaveBeenCalledWith('https://storage.googleapis.com/test-bucket/image.jpg');
      expect(fs.promises.writeFile).toHaveBeenCalled();
      
      // Verify file was processed after download
      expect(result.content).toBeInstanceOf(Buffer);
      // Content type would depend on your implementation
    });
    
    it('should handle errors in file processing', async () => {
      // Setup failure in file reading
      fs.promises.readFile.mockRejectedValue(new Error('File read error'));
      
      // Verify error handling
      await expect(processFileForMultimodal('/tmp/file.txt', 'file.txt', 'text/plain')).rejects.toThrow();
    });
  });
});