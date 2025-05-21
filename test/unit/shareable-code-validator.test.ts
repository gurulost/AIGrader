import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';

describe('Shareable Code Validation', () => {
  // Mock storage service
  const mockStorage = {
    getAssignmentByCode: vi.fn()
  };
  
  // Mock request and response
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: any;
  
  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
    
    // Create mock request with body
    mockRequest = {
      body: {},
      params: {}
    };
    
    // Create mock response
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      sendStatus: vi.fn()
    };
    
    // Create mock next function
    mockNext = vi.fn();
  });
  
  // Define the validator function to test in isolation
  const validateShareableCode = async (req: Request, res: Response, next: any) => {
    try {
      // For shareable link submissions, require shareableCode
      if (!req.body.shareableCode) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid submission data'
        });
      }
      
      // Verify the code matches the assignment
      if (req.body.assignmentId) {
        const assignment = await mockStorage.getAssignmentByCode(req.body.shareableCode);
        
        if (!assignment || assignment.id.toString() !== req.body.assignmentId.toString()) {
          return res.status(403).json({
            status: 'error',
            message: 'Invalid shareable code for this assignment'
          });
        }
      }
      
      // If validation passes, continue
      next();
    } catch (error) {
      console.error('Error validating shareable code:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error validating submission'
      });
    }
  };
  
  it('should reject requests without a shareable code', async () => {
    // Call the validator
    await validateShareableCode(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Check response
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      message: 'Invalid submission data'
    }));
    expect(mockNext).not.toHaveBeenCalled();
  });
  
  it('should reject when code does not match assignment', async () => {
    // Setup request with incorrect code
    mockRequest.body = {
      assignmentId: '123',
      shareableCode: 'INVALID_CODE'
    };
    
    // Mock storage to return null (no assignment found)
    mockStorage.getAssignmentByCode.mockResolvedValue(null);
    
    // Call the validator
    await validateShareableCode(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Check response
    expect(mockStorage.getAssignmentByCode).toHaveBeenCalledWith('INVALID_CODE');
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      message: 'Invalid shareable code for this assignment'
    }));
    expect(mockNext).not.toHaveBeenCalled();
  });
  
  it('should reject when code matches but assignment ID does not', async () => {
    // Setup request with correct code but wrong assignment ID
    mockRequest.body = {
      assignmentId: '123',
      shareableCode: 'VALID_CODE'
    };
    
    // Mock storage to return an assignment with a different ID
    mockStorage.getAssignmentByCode.mockResolvedValue({
      id: 456,
      title: 'Different Assignment',
      shareableCode: 'VALID_CODE'
    });
    
    // Call the validator
    await validateShareableCode(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Check response
    expect(mockStorage.getAssignmentByCode).toHaveBeenCalledWith('VALID_CODE');
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      message: 'Invalid shareable code for this assignment'
    }));
    expect(mockNext).not.toHaveBeenCalled();
  });
  
  it('should allow valid shareable code for matching assignment', async () => {
    // Setup request with correct code and matching assignment ID
    mockRequest.body = {
      assignmentId: '123',
      shareableCode: 'VALID_CODE'
    };
    
    // Mock storage to return an assignment with matching ID
    mockStorage.getAssignmentByCode.mockResolvedValue({
      id: 123,
      title: 'Correct Assignment',
      shareableCode: 'VALID_CODE'
    });
    
    // Call the validator
    await validateShareableCode(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Check that next was called (validation passed)
    expect(mockStorage.getAssignmentByCode).toHaveBeenCalledWith('VALID_CODE');
    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });
  
  it('should handle server errors gracefully', async () => {
    // Setup request
    mockRequest.body = {
      assignmentId: '123',
      shareableCode: 'ERROR_CODE'
    };
    
    // Mock storage to throw an error
    mockStorage.getAssignmentByCode.mockRejectedValue(new Error('Database error'));
    
    // Mock console.error to prevent test output pollution
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Call the validator
    await validateShareableCode(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Check response
    expect(mockStorage.getAssignmentByCode).toHaveBeenCalledWith('ERROR_CODE');
    expect(mockConsoleError).toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      message: 'Server error validating submission'
    }));
    expect(mockNext).not.toHaveBeenCalled();
    
    // Restore console.error
    mockConsoleError.mockRestore();
  });
});