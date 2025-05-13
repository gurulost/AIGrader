import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useDropzone } from "react-dropzone";
import { FileText, Upload, CheckCircle, X, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { API_ROUTES } from "@/lib/constants";
import { Rubric } from '@shared/schema';

interface RubricTesterProps {
  rubric: Rubric;
  assignmentTitle: string;
  assignmentDescription: string;
}

interface FeedbackResult {
  strengths: string[];
  improvements: string[];
  suggestions: string[];
  summary: string;
  score?: number;
}

export function RubricTester({ rubric, assignmentTitle, assignmentDescription }: RubricTesterProps) {
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [codeContent, setCodeContent] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configure dropzone
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/plain': ['.txt', '.py', '.java', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json'],
      'application/octet-stream': ['.py', '.java', '.js', '.ts', '.jsx', '.tsx'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    multiple: false,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles && acceptedFiles.length > 0) {
        setFile(acceptedFiles[0]);
        
        // Read file content
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            setCodeContent(e.target.result as string);
          }
        };
        reader.readAsText(acceptedFiles[0]);
      }
    },
    onDropRejected: (rejections) => {
      const rejection = rejections[0];
      if (rejection.errors[0].code === 'file-too-large') {
        toast({
          variant: "destructive",
          title: "File too large",
          description: "Maximum file size is 10MB.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file",
          description: "Please upload a valid file type.",
        });
      }
    }
  });

  const handleReset = () => {
    setFile(null);
    setCodeContent("");
    setFeedback(null);
  };

  const handleSubmit = async () => {
    if (!codeContent.trim() && !file) {
      toast({
        variant: "destructive",
        title: "No code provided",
        description: "Please enter code or upload a file to test.",
      });
      return;
    }

    try {
      setIsSubmitting(true);

      // Prepare rubric context for AI
      const rubricContext = rubric.criteria.map(c => 
        `${c.name} (${c.type}, Max Score: ${c.maxScore}, Weight: ${c.weight}): ${c.description}`
      ).join("\n");

      // Prepare assignment context
      const assignmentContext = `
Assignment: ${assignmentTitle}
Description: ${assignmentDescription}

Rubric:
${rubricContext}

Please evaluate this submission according to the above rubric criteria.
      `;

      // Send API request to test rubric
      const response = await apiRequest('POST', '/api/test-rubric', {
        content: codeContent,
        assignmentContext
      });

      const result = await response.json();
      setFeedback(result);

      toast({
        title: "Feedback Generated",
        description: "AI has generated feedback based on your rubric.",
      });
    } catch (error) {
      console.error("Error testing rubric:", error);
      toast({
        variant: "destructive",
        title: "Test Failed",
        description: "Failed to generate feedback. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Test Your Rubric</CardTitle>
        <CardDescription>
          Test your rubric by submitting code and seeing how the AI evaluates it
        </CardDescription>
      </CardHeader>
      <CardContent>
        {feedback ? (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Generated Feedback</h3>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <X className="mr-1 h-4 w-4" />
                Reset
              </Button>
            </div>

            {feedback.score !== undefined && (
              <div className="p-4 bg-secondary/20 rounded-md flex items-center justify-between">
                <span className="font-medium">Score</span>
                <span className="text-lg font-bold">{feedback.score}/100</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-2">Summary</h4>
                <p className="text-sm p-3 bg-secondary/10 rounded-md">{feedback.summary}</p>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2 text-green-600">Strengths</h4>
                <ul className="space-y-2">
                  {feedback.strengths.map((item, index) => (
                    <li key={index} className="flex items-start text-sm">
                      <CheckCircle className="h-4 w-4 mr-2 text-green-600 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2 text-amber-600">Areas for Improvement</h4>
                <ul className="space-y-2">
                  {feedback.improvements.map((item, index) => (
                    <li key={index} className="flex items-start text-sm">
                      <span className="h-4 w-4 mr-2 text-amber-600 mt-0.5 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2 text-blue-600">Suggestions</h4>
                <ul className="space-y-2">
                  {feedback.suggestions.map((item, index) => (
                    <li key={index} className="flex items-start text-sm">
                      <span className="h-4 w-4 mr-2 text-blue-600 mt-0.5 shrink-0">→</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload File</TabsTrigger>
              <TabsTrigger value="paste">Paste Code</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              {file ? (
                <div className="border rounded-md p-4">
                  <div className="flex items-center">
                    <FileText className="h-8 w-8 mr-2 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
                    isDragActive ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <input {...getInputProps()} ref={fileInputRef} />
                  <div className="flex flex-col items-center space-y-2">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <h3 className="font-medium">
                      {isDragActive ? "Drop the file here" : "Drag and drop file"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      or click to select file
                    </p>
                    <p className="text-xs text-muted-foreground">
                      (Max size: 10MB)
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="paste" className="space-y-4">
              <Textarea
                placeholder="Paste your code here..."
                className="min-h-[300px] font-mono text-sm"
                value={codeContent}
                onChange={(e) => setCodeContent(e.target.value)}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
      <CardFooter>
        {!feedback ? (
          <Button 
            className="w-full" 
            onClick={handleSubmit}
            disabled={isSubmitting || (!file && !codeContent.trim())}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Feedback...
              </>
            ) : (
              "Test Rubric"
            )}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}