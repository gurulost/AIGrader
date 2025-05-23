import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { API_ROUTES, USER_ROLES } from "@/lib/constants";
import { InstructorShell } from "@/components/layout/instructor-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, FileDown, GraduationCap } from "lucide-react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("all");
  
  // Redirect non-instructors away
  useEffect(() => {
    if (user?.role !== USER_ROLES.INSTRUCTOR && user?.role !== USER_ROLES.ADMIN) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  // Fetch all courses
  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: [API_ROUTES.COURSES],
    queryFn: async () => {
      const response = await fetch(API_ROUTES.COURSES);
      if (!response.ok) {
        throw new Error('Failed to fetch courses');
      }
      return response.json();
    },
  });

  // Fetch all students
  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ["students", selectedCourse],
    queryFn: async () => {
      const url = selectedCourse !== "all"
        ? `${API_ROUTES.COURSES}/${selectedCourse}/students`
        : "/api/students";

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch students");
      }
      return response.json();
    },
  });

  // Define student type
interface Student {
  id: number;
  name: string;
  email: string;
  enrolledCourses?: number;
  progress?: number;
}

  // Filter students based on search query
  const filteredStudents = students.filter((student: Student) => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        student.email.toLowerCase().includes(searchQuery.toLowerCase());

    const progress = student.progress ?? 0;
    const matchesTab = activeTab === "all" ||
                      (activeTab === "active" && progress > 0.4) ||
                      (activeTab === "inactive" && progress <= 0.4);

    return matchesSearch && matchesTab;
  });

  // Handle course selection change
  const handleCourseChange = (value: string) => {
    setSelectedCourse(value);
  };

  // Handle export to CSV
  const handleExport = () => {
    // This is a placeholder - implement actual CSV export functionality
    alert("Export functionality would download a CSV of the current students view");
  };

  return (
    <InstructorShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Students</h1>
          <p className="text-muted-foreground">
            Manage and track all students across your courses
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search students..."
                className="w-full pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={selectedCourse} onValueChange={handleCourseChange}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Courses</SelectItem>
                {courses.map((course: { id: number; name: string }) => (
                  <SelectItem key={course.id} value={course.id.toString()}>
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport}>
              <FileDown className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All Students</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="inactive">Inactive</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            <StudentsTable students={filteredStudents} isLoading={studentsLoading} />
          </TabsContent>
          <TabsContent value="active" className="mt-4">
            <StudentsTable students={filteredStudents} isLoading={studentsLoading} />
          </TabsContent>
          <TabsContent value="inactive" className="mt-4">
            <StudentsTable students={filteredStudents} isLoading={studentsLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </InstructorShell>
  );
}

interface StudentsTableProps {
  students: any[];
  isLoading: boolean;
}

function StudentsTable({ students, isLoading }: StudentsTableProps) {
  const [, navigate] = useLocation();
  
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GraduationCap className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No students found</h3>
        <p className="text-muted-foreground">
          Try changing your search or filters
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="hidden md:table-cell">Enrolled Courses</TableHead>
              <TableHead className="hidden md:table-cell">Progress</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.id}>
                <TableCell className="font-medium">{student.name}</TableCell>
                <TableCell>{student.email}</TableCell>
                <TableCell className="hidden md:table-cell">{student.enrolledCourses ?? '-'}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-maroon-600"
                        style={{ width: `${(student.progress ?? 0) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs">{Math.round((student.progress ?? 0) * 100)}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      // This is a placeholder - implement actual student detail view
                      // navigate(`/instructor/student/${student.id}`);
                      alert(`View student ${student.id} details (not implemented yet)`);
                    }}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}