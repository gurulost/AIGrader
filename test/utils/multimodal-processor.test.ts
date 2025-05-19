import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFileForMultimodal } from '../../server/utils/multimodal-processor';
import { determineContentType, isFileTypeAllowed } from '../../server/utils/file-type-settings';

// Mock modules with inline functions
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn()
  },
  readFile: vi.fn()
}));

vi.mock('../../server/utils/file-type-settings', () => ({
  determineContentType: vi.fn(),
  isFileTypeAllowed: vi.fn().mockResolvedValue(true)
}));

// Import fs after mocking
import fs from 'fs';

describe('Multimodal Processor Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFileTypeAllowed).mockResolvedValue(true);
  });

  describe('processFileForMultimodal', () => {
    it('should process text files correctly', async () => {
      // Setup
      const textContent = 'This is a sample text content';
      const buffer = Buffer.from(textContent);
      vi.mocked(determineContentType).mockReturnValue('text');
      vi.mocked(fs.promises.readFile).mockResolvedValue(buffer);
      
      // Execute
      const result = await processFileForMultimodal(
        '/path/to/file.txt', 
        'file.txt', 
        'text/plain'
      );
      
      // Verify
      expect(result).toBeDefined();
      expect(result.contentType).toBe('text');
      expect(result.content).toBe(textContent);
      expect(result.textContent).toBe(textContent);
      expect(result.mimeType).toBe('text/plain');
      expect(fs.promises.readFile).toHaveBeenCalledWith('/path/to/file.txt');
      expect(determineContentType).toHaveBeenCalledWith('txt', 'text/plain');
    });

    it('should process image files correctly', async () => {
      // Setup
      const imageBuffer = Buffer.from('mock-image-data');
      vi.mocked(determineContentType).mockReturnValue('image');
      vi.mocked(fs.promises.readFile).mockResolvedValue(imageBuffer);
      
      // Execute
      const result = await processFileForMultimodal(
        '/path/to/image.jpg', 
        'image.jpg', 
        'image/jpeg'
      );
      
      // Verify
      expect(result).toBeDefined();
      expect(result.contentType).toBe('image');
      expect(result.content).toBe(imageBuffer);
      expect(result.textContent).toBeUndefined();
      expect(result.mimeType).toBe('image/jpeg');
      expect(determineContentType).toHaveBeenCalledWith('jpg', 'image/jpeg');
    });

    it('should handle document files correctly', async () => {
      // Setup
      const docBuffer = Buffer.from('mock-pdf-data');
      vi.mocked(determineContentType).mockReturnValue('document');
      vi.mocked(fs.promises.readFile).mockResolvedValue(docBuffer);
      
      // Execute
      const result = await processFileForMultimodal(
        '/path/to/doc.pdf', 
        'doc.pdf', 
        'application/pdf'
      );
      
      // Verify
      expect(result).toBeDefined();
      expect(result.contentType).toBe('document');
      expect(result.content).toBe(docBuffer);
      expect(result.mimeType).toBe('application/pdf');
      expect(determineContentType).toHaveBeenCalledWith('pdf', 'application/pdf');
    });

    it('should handle CSV files as documents', async () => {
      // Setup
      const csvContent = 'id,name,email\n1,John,john@example.com';
      const buffer = Buffer.from(csvContent);
      vi.mocked(determineContentType).mockReturnValue('document');
      vi.mocked(fs.promises.readFile).mockResolvedValue(buffer);
      
      // Execute
      const result = await processFileForMultimodal(
        '/path/to/data.csv', 
        'data.csv', 
        'text/csv'
      );
      
      // Verify
      expect(result).toBeDefined();
      expect(result.contentType).toBe('document');
      expect(result.mimeType).toBe('text/csv');
      expect(determineContentType).toHaveBeenCalledWith('csv', 'text/csv');
    });

    it('should handle unknown file types gracefully', async () => {
      // Setup
      const unknownContent = Buffer.from([0x01, 0x02, 0x03]);
      vi.mocked(determineContentType).mockReturnValue('text'); // Default fallback
      vi.mocked(fs.promises.readFile).mockResolvedValue(unknownContent);
      
      // Execute
      const result = await processFileForMultimodal(
        '/path/to/unknown.bin', 
        'unknown.bin', 
        'application/octet-stream'
      );
      
      // Verify
      expect(result).toBeDefined();
      expect(result.contentType).toBe('text');
      expect(result.mimeType).toBe('application/octet-stream');
      expect(determineContentType).toHaveBeenCalledWith('bin', 'application/octet-stream');
    });
    
    it('should handle file type not allowed errors', async () => {
      // Setup
      vi.mocked(determineContentType).mockReturnValue('video');
      vi.mocked(isFileTypeAllowed).mockResolvedValue(false);
      
      // Execute & Verify
      await expect(
        processFileForMultimodal('/path/to/file.mp4', 'file.mp4', 'video/mp4')
      ).rejects.toThrow('File type mp4 (video/mp4) is not allowed for processing');
    });

    it('should handle read file errors gracefully', async () => {
      // Setup
      vi.mocked(determineContentType).mockReturnValue('text');
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('File read error'));
      
      // Execute & Verify
      await expect(
        processFileForMultimodal('/path/to/nonexistent.txt', 'nonexistent.txt', 'text/plain')
      ).rejects.toThrow();
    });
  });
});