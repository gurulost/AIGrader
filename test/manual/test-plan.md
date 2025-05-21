# Academus Functionality Test Plan

This document outlines a comprehensive test plan for verifying all functionality in the Academus platform is working correctly across different user roles.

## Test Accounts
- Admin: admin@test.com / admin123
- Instructor: instructor@test.com / instructor123
- Student: student@test.com / student123

## 1. Authentication Tests

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| Admin Login | 1. Navigate to /auth<br>2. Enter admin@test.com and admin123<br>3. Click Login | Should redirect to admin dashboard | |
| Instructor Login | 1. Navigate to /auth<br>2. Enter instructor@test.com and instructor123<br>3. Click Login | Should redirect to instructor dashboard | |
| Student Login | 1. Navigate to /auth<br>2. Enter student@test.com and student123<br>3. Click Login | Should redirect to student dashboard | |
| Failed Login | 1. Navigate to /auth<br>2. Enter wrong credentials<br>3. Click Login | Should show error message and remain on login page | |
| Logout | 1. Login with any account<br>2. Click Logout button | Should redirect to login page, session should be terminated | |

## 2. Course Management Tests (Instructor)

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| View All Courses | 1. Login as instructor<br>2. Navigate to Courses section | Should display list of instructor's courses | |
| Create New Course | 1. Click "New Course" button<br>2. Fill in details (title, description)<br>3. Submit form | Course should be created and appear in course list | |
| View Course Details | 1. Click on a specific course | Should display course details and associated assignments | |
| Edit Course | 1. Navigate to course details<br>2. Click Edit button<br>3. Modify details<br>4. Save changes | Changes should be saved and displayed correctly | |

## 3. Assignment Management Tests (Instructor)

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| View All Assignments | 1. Login as instructor<br>2. Navigate to Assignments section | Should display list of instructor's assignments | |
| Create Assignment (No Course) | 1. Click "New Assignment" button<br>2. Fill details without selecting a course<br>3. Create rubric<br>4. Submit form | Assignment should be created as standalone | |
| Create Assignment (With Course) | 1. Click "New Assignment" button<br>2. Fill details and select a course<br>3. Create rubric<br>4. Submit form | Assignment should be created and associated with course | |
| Generate Shareable Link | 1. Navigate to assignment details<br>2. Click "Generate Link" button | Should generate and display shareable link | |
| Change Assignment Status | 1. Navigate to assignment details<br>2. Change status (Upcoming → Active → Completed)<br>3. Save changes | Status should update and affect visibility to students | |
| Test Rubric | 1. Navigate to assignment creation/edit<br>2. Create rubric<br>3. Use "Test Rubric" feature<br>4. Upload sample file<br>5. Submit | Should display AI-generated feedback based on rubric | |

## 4. Student Experience Tests

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| View Enrolled Courses | 1. Login as student<br>2. Navigate to Courses section | Should display list of enrolled courses | |
| View Available Assignments | 1. Navigate to Assignments section | Should show all available assignments from enrolled courses | |
| View Course Assignments | 1. Navigate to a specific course<br>2. View course details | Should show assignments associated with that course | |
| Submit Assignment | 1. Navigate to an active assignment<br>2. Upload a file<br>3. Click Submit | Should submit successfully and show confirmation | |
| View Submission History | 1. Navigate to "My Submissions" section | Should display all previous submissions with status | |
| View Assignment Feedback | 1. Navigate to a graded submission<br>2. View details | Should display AI-generated feedback with strengths/improvements | |

## 5. Shareable Link Tests

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| Access via Link (Logged In) | 1. Login as student<br>2. Access assignment via shareable link | Should show assignment details and submission form | |
| Access via Link (Not Logged In) | 1. Logout/use incognito<br>2. Access assignment via shareable link | Should require authentication before allowing submission | |
| Submit via Link | 1. Login as student<br>2. Access via link<br>3. Submit assignment | Submission should be properly attributed to student | |

## 6. Admin Functions Tests

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| View System Dashboard | 1. Login as admin<br>2. Access admin dashboard | Should display system-wide statistics | |
| View All Users | 1. Navigate to Users section | Should display list of all users with roles | |
| View All Courses | 1. Navigate to Courses section | Should display all courses in system | |
| View All Assignments | 1. Navigate to Assignments section | Should display all assignments in system | |

## 7. Instructor Analytics Tests

| Test Case | Steps | Expected Result | Status |
|-----------|-------|-----------------|--------|
| View Course Analytics | 1. Login as instructor<br>2. Navigate to a course<br>3. View analytics tab | Should display engagement and submission statistics | |
| View Assignment Analytics | 1. Navigate to an assignment<br>2. View analytics | Should display submission statistics and feedback trends | |
| Export Grades | 1. Navigate to a course<br>2. Use export grades function | Should download CSV with student grades | |

## Notes on Test Execution:
- Run tests on latest development version
- Document any bugs or inconsistencies with screenshots
- Note browser and device information for any issues
- Test both desktop and mobile views where applicable