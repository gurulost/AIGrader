import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { InstructorShell } from "@/components/layout/instructor-shell";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { API_ROUTES, APP_ROUTES } from "@/lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Rubric } from '@shared/schema';
import { RubricBuilder } from "@/components/instructor/rubric-builder";
import { RubricTester } from "@/components/instructor/rubric-tester";
import { ShareableLink } from "@/components/instructor/shareable-link";
import { TooltipInfo } from "@/components/ui/tooltip-info";

// Create a schema for assignment creation
const assignmentSchema = z.object({
  title: z.string().min(3, { message: "Title must be at least 3 characters" }),
  description: z.string().min(10, { message: "Description must be at least 10 characters" }),
  courseId: z.string({ required_error: "Please select a course" }).transform(val => parseInt(val)),
  dueDate: z.date({ required_error: "Please select a due date" }),
});

type AssignmentFormValues = z.infer<typeof assignmentSchema>;

export default function CreateAssignment() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [rubric, setRubric] = useState<Rubric>({ criteria: [], passingThreshold: 60 });
  const [createdAssignment, setCreatedAssignment] = useState<any>(null);
  const queryClient = useQueryClient();
  
  // Form validation and state
  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      title: "",
      description: "",
      dueDate: new Date(new Date().setDate(new Date().getDate() + 14)), // Default to 2 weeks from now
    },
  });
  
  // Fetch courses for the dropdown
  const { data: courses = [] } = useQuery({
    queryKey: [API_ROUTES.COURSES],
  });
  
  // Handle form submission
  const handleSubmit = async (values: AssignmentFormValues) => {
    try {
      setSubmitting(true);
      
      // Prepare the payload
      const payload = {
        ...values,
        dueDate: values.dueDate.toISOString(),
        rubric: rubric.criteria.length > 0 ? {
          criteria: rubric.criteria,
          totalPoints: rubric.criteria.reduce((sum, c) => sum + c.maxScore * c.weight, 0),
          passingThreshold: rubric.passingThreshold,
        } : undefined,
      };
      
      // Send request to create assignment
      const response = await fetch(API_ROUTES.ASSIGNMENTS, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create assignment: ${response.statusText}`);
      }
      
      const assignment = await response.json();
      
      // Update UI with the newly created assignment
      setCreatedAssignment(assignment);
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [API_ROUTES.ASSIGNMENTS] });
      
      // Show success toast
      toast({
        title: "Assignment Created",
        description: "Your assignment has been successfully created",
      });
    } catch (error) {
      console.error('Error creating assignment:', error);
      toast({
        title: "Error",
        description: "Failed to create assignment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };
  
  return (
    <InstructorShell>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Create Assignment</h1>
          <p className="text-muted-foreground">Define a new assignment with AI feedback criteria</p>
        </div>
        
        {createdAssignment ? (
          <div className="space-y-6">
            <Card className="border-green-200 bg-green-50/50">
              <CardHeader className="pb-4">
                <CardTitle>Assignment Created Successfully</CardTitle>
                <CardDescription>
                  Your assignment has been created and is ready to share with students
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium">Title</h3>
                  <p>{createdAssignment.title}</p>
                </div>
                <div>
                  <h3 className="font-medium">Description</h3>
                  <p className="text-sm text-neutral-600">{createdAssignment.description}</p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <h3 className="font-medium">Due Date</h3>
                    <p className="text-sm">{new Date(createdAssignment.dueDate).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <h3 className="font-medium">Status</h3>
                    <p className="text-sm capitalize">{createdAssignment.status}</p>
                  </div>
                </div>
                
                <Separator />
                
                <ShareableLink 
                  assignmentId={createdAssignment.id}
                  shareableCode={createdAssignment.shareableCode}
                />
                
                <div className="pt-4 flex justify-between">
                  <Button 
                    variant="outline"
                    onClick={() => navigate(APP_ROUTES.INSTRUCTOR_DASHBOARD)}
                  >
                    Return to Dashboard
                  </Button>
                  <Button 
                    onClick={() => {
                      setCreatedAssignment(null);
                      form.reset();
                      setRubric({ criteria: [], passingThreshold: 60 });
                    }}
                  >
                    Create Another Assignment
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Assignment Details</CardTitle>
                  <CardDescription>
                    Basic information about the assignment
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel>Title</FormLabel>
                          <TooltipInfo content={
                            <>
                              <p className="font-medium">How this is used:</p>
                              <p>The title is displayed to students on their dashboard and appears in the AI-generated feedback. It helps students identify assignments and provides context for the AI.</p>
                              <p className="mt-1 font-medium">Tips:</p>
                              <ul className="list-disc pl-4 space-y-1">
                                <li>Keep it clear, descriptive, and specific (e.g., "Python Loop Implementation Exercise")</li>
                                <li>Include programming language/concept to help the AI contextualize</li>
                                <li>Avoid generic titles like "Assignment 1" as they provide less context for AI feedback</li>
                              </ul>
                            </>
                          } />
                        </div>
                        <FormControl>
                          <Input 
                            placeholder="Enter assignment title"
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          A clear, concise title for the assignment
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel>Description</FormLabel>
                          <TooltipInfo content={
                            <>
                              <p className="font-medium">How this is used:</p>
                              <p>The description is sent to the AI along with student submissions to provide context for feedback. It's also shown to students when they view the assignment.</p>
                              <p className="mt-1 font-medium">Tips:</p>
                              <ul className="list-disc pl-4 space-y-1">
                                <li>Be specific about what the code should accomplish</li>
                                <li>Mention programming languages, frameworks, or libraries students should use</li>
                                <li>Include any specific requirements or constraints</li>
                                <li>Add examples or sample inputs/outputs if applicable</li>
                                <li>The AI will use this context to provide more accurate feedback</li>
                              </ul>
                            </>
                          } />
                        </div>
                        <FormControl>
                          <Textarea 
                            placeholder="Enter detailed assignment instructions"
                            className="min-h-32"
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Provide detailed instructions, requirements, and expectations
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid gap-6 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="courseId"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center space-x-2">
                            <FormLabel>Course</FormLabel>
                            <TooltipInfo content={
                              <>
                                <p className="font-medium">How this is used:</p>
                                <p>The course determines which students will see this assignment on their dashboard and be able to submit solutions.</p>
                                <p className="mt-1 font-medium">Tips:</p>
                                <ul className="list-disc pl-4 space-y-1">
                                  <li>Only students enrolled in this course will have access to the assignment</li>
                                  <li>Make sure all students who need to complete this assignment are enrolled in the selected course</li>
                                  <li>Students can be enrolled in multiple courses simultaneously</li>
                                </ul>
                              </>
                            } />
                          </div>
                          <Select 
                            onValueChange={field.onChange} 
                            defaultValue={field.value?.toString()}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select course" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {courses.map((course: any) => (
                                <SelectItem key={course.id} value={course.id.toString()}>
                                  {course.name} ({course.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            The course this assignment belongs to
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <div className="flex items-center space-x-2">
                            <FormLabel>Due Date</FormLabel>
                            <TooltipInfo content={
                              <>
                                <p className="font-medium">How this is used:</p>
                                <p>The due date is displayed to students and determines when the assignment is no longer accepting submissions. It's also useful for AI scoring context.</p>
                                <p className="mt-1 font-medium">Tips:</p>
                                <ul className="list-disc pl-4 space-y-1">
                                  <li>Allow sufficient time for students to complete the assignment</li>
                                  <li>Due dates can impact how the AI evaluates "timeliness" in feedback</li>
                                  <li>Students can submit before the deadline but not after</li>
                                  <li>Setting a reasonable deadline encourages better time management</li>
                                </ul>
                              </>
                            } />
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date()}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormDescription>
                            Deadline for submission
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-2">
                    <CardTitle>Rubric Builder</CardTitle>
                    <TooltipInfo content={
                      <>
                        <p className="font-medium">How this is used:</p>
                        <p>The rubric is the most important element for AI feedback. It defines what aspects of the submission the AI should evaluate and how to weight the scoring.</p>
                        <p className="mt-1 font-medium">Tips:</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>Each criterion should be specific and measurable</li>
                          <li>Higher weight criteria have more impact on final score</li>
                          <li>Include criteria for both technical correctness and code quality</li>
                          <li>The AI uses these criteria to structure its feedback</li>
                          <li>Use the "Test Rubric" feature below to see how the AI will apply your rubric</li>
                        </ul>
                      </>
                    } />
                  </div>
                  <CardDescription>
                    Define criteria for AI evaluation of student submissions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RubricBuilder 
                    value={rubric} 
                    onChange={setRubric} 
                  />
                </CardContent>
              </Card>
              
              {rubric.criteria.length > 0 && (
                <RubricTester 
                  rubric={rubric}
                  assignmentTitle={form.watch("title") || "Untitled Assignment"}
                  assignmentDescription={form.watch("description") || "No description provided"}
                />
              )}
              
              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(APP_ROUTES.INSTRUCTOR_DASHBOARD)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <span className="mr-2">Creating...</span>
                    </>
                  ) : (
                    'Create Assignment'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </div>
    </InstructorShell>
  );
}