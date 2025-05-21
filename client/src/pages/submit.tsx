import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { API_ROUTES, APP_ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/ui/file-upload";
import { QuillEditor } from "@/components/quill-editor";
import { QuillContent } from "@/components/quill-content";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SubmitAssignmentProps {
  code?: string;
}

export default function SubmitAssignment({ code: propCode }: SubmitAssignmentProps) {
  const [match, params] = useRoute('/submit/:code');
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  
  // Use the code from props or from the route params
  const assignmentCode = propCode || params?.code;

  // State for assignment lookup
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<{
    id: number;
    title: string;
    description: string;
    courseName?: string;
    courseCode?: string;
    dueDate: string;
    shareableCode: string;
  } | null>(null);
  
  // State for submission
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [codeContent, setCodeContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitType, setSubmitType] = useState<'code' | 'file'>('code');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      // Encode current URL to redirect back after login
      const returnUrl = encodeURIComponent(`/submit/${assignmentCode}`);
      navigate(`/login?returnTo=${returnUrl}`);
    }
  }, [isAuthenticated, assignmentCode, navigate]);

  // Fetch assignment data using the code
  useEffect(() => {
    if (!match || !assignmentCode) return;
    // Skip fetching if not authenticated
    if (!isAuthenticated) return;
    
    const fetchAssignment = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`${API_ROUTES.ASSIGNMENTS}/code/${assignmentCode}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Assignment not found. The link may be incorrect or expired.');
          }
          throw new Error('Failed to load assignment details.');
        }
        
        const data = await response.json();
        
        // Verify the assignment has a shareable code
        if (!data.shareableCode) {
          throw new Error('Invalid assignment link. This assignment may not allow link-based submissions.');
        }
        
        setAssignment(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred while loading the assignment.';
        setError(errorMessage);
        console.error('Error fetching assignment by code:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAssignment();
  }, [match, assignmentCode, isAuthenticated]);
  
  // Pre-fill form if user is authenticated
  useEffect(() => {
    if (user && isAuthenticated) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user, isAuthenticated]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!assignment) return;
    
    try {
      setSubmitting(true);
      
      // Form validation
      if (!name.trim()) {
        toast({
          title: "Missing Information",
          description: "Please enter your name.",
          variant: "destructive",
        });
        return;
      }
      
      if (!email.trim() || !email.includes('@')) {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address.",
          variant: "destructive",
        });
        return;
      }
      
      if (submitType === 'code' && !codeContent.trim()) {
        toast({
          title: "Missing Code",
          description: "Please enter your code.",
          variant: "destructive",
        });
        return;
      }
      
      if (submitType === 'file' && !file) {
        toast({
          title: "Missing File",
          description: "Please upload a file.",
          variant: "destructive",
        });
        return;
      }
      
      // Prepare form data
      const formData = new FormData();
      formData.append('assignmentId', assignment.id.toString());
      formData.append('submissionType', submitType);
      formData.append('name', name);
      formData.append('email', email);
      
      // Critical security parameter - include the shareable code for validation
      formData.append('shareableCode', assignment.shareableCode);
      
      if (notes) formData.append('notes', notes);
      if (submitType === 'code') formData.append('code', codeContent);
      if (submitType === 'file' && file) formData.append('file', file);
      
      // Send submission (now using authenticated endpoint)
      const response = await fetch('/api/submissions', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        // Handle different error types with appropriate messages
        if (response.status === 403) {
          throw new Error('Access denied. The submission link may have expired or is invalid.');
        } else if (response.status === 404) {
          throw new Error('Assignment not found. Please check the link and try again.');
        } else if (response.status === 400) {
          const errorData = await response.json();
          throw new Error(`Submission failed: ${errorData.message || response.statusText}`);
        } else {
          throw new Error(`Submission failed: ${response.statusText}`);
        }
      }
      
      // Show success message
      toast({
        title: "Submission Successful",
        description: "Your work has been submitted for review!",
      });
      
      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting assignment:', error);
      toast({
        title: "Submission Failed",
        description: error instanceof Error 
          ? error.message 
          : "There was a problem submitting your work. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading assignment details...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader className="bg-destructive/10">
            <CardTitle className="text-destructive">Assignment Not Found</CardTitle>
            <CardDescription className="text-destructive/80">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="text-center mb-4">
              <p className="mb-6">
                Please check the link and try again, or contact your instructor.
              </p>
              <Button onClick={() => navigate('/')}>Go to Homepage</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (submitted && assignment) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader className="bg-green-50">
            <CardTitle className="text-green-600">Submission Successful!</CardTitle>
            <CardDescription>
              Your work has been submitted successfully
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="text-center mb-4">
              <p className="mb-6">
                Thank you for submitting your work to <strong>{assignment.title}</strong>. 
                Your submission has been received and will be processed by our AI system for feedback.
              </p>
              {/* All submissions now require authentication */}
              <div className="flex justify-center space-x-4">
                <Button variant="outline" onClick={() => setSubmitted(false)}>
                  Submit Another
                </Button>
                <Button onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login')}>
                  {isAuthenticated ? 'Go to Dashboard' : 'Sign In'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // Return null if no assignment data
  if (!assignment) {
    return null;
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container px-4 mx-auto max-w-4xl">
        <Card className="shadow-lg">
          <CardHeader className="bg-primary/5">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
              <div>
                <CardTitle className="text-xl">{assignment.title}</CardTitle>
                <CardDescription>
                  {assignment.courseName && assignment.courseCode 
                    ? `${assignment.courseName} (${assignment.courseCode})`
                    : 'Assignment'
                  }
                </CardDescription>
              </div>
              <div className="text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span className="material-icons-outlined text-sm">event</span>
                  <span>Due: {new Date(assignment.dueDate).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            
            {/* Authentication notification banner */}
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800 flex items-start gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>
                <strong>Authentication Required:</strong> All submissions require user authentication to maintain academic integrity and track progress.
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-2">Assignment Description</h3>
              <QuillContent 
                content={assignment.description || ''} 
                className="text-muted-foreground text-sm" 
              />
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Your Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <QuillEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Add any notes or comments about your submission"
                />
              </div>
              
              <div className="space-y-4">
                <Label>Submission</Label>
                <Tabs
                  value={submitType}
                  onValueChange={(value) => setSubmitType(value as 'code' | 'file')}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="code">Code</TabsTrigger>
                    <TabsTrigger value="file">File Upload</TabsTrigger>
                  </TabsList>
                  <TabsContent value="code" className="space-y-4 pt-4">
                    <Textarea
                      placeholder="Paste your code here"
                      className="font-mono min-h-[200px]"
                      value={codeContent}
                      onChange={(e) => setCodeContent(e.target.value)}
                      disabled={submitting}
                    />
                  </TabsContent>
                  <TabsContent value="file" className="space-y-4 pt-4">
                    <FileUpload
                      onValueChange={(files: File[]) => setFile(files[0] || null)}
                      disabled={submitting}
                      accept=".py,.java,.cpp,.ipynb,.zip,.js,.ts,.html,.css,.md,.txt"
                      maxSize={10 * 1024 * 1024} // 10MB
                    />
                  </TabsContent>
                </Tabs>
              </div>
              
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Assignment'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}