import { db } from '../db';
import { submissions, feedback } from '@shared/schema';
import { eq, count, avg, max, min, gt, lt, between, and, desc, sql } from 'drizzle-orm';

/**
 * Service for collecting and analyzing system performance metrics
 * This will be useful for monitoring system health and performance with large class sizes
 */
export class MetricsService {
  /**
   * Get submission processing statistics
   */
  async getProcessingStats(): Promise<{
    averageProcessingTimeMs: number;
    totalProcessed: number;
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    failedCount: number;
    lastHourCount: number;
    lastDayCount: number;
  }> {
    // Calculate average processing time from feedback records
    const [avgResult] = await db
      .select({ avg: avg(feedback.processingTime).as('average') })
      .from(feedback);
    
    // Get count of submissions by status
    const [pendingResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(eq(submissions.status, 'pending'));
    
    const [processingResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(eq(submissions.status, 'processing'));
    
    const [completedResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(eq(submissions.status, 'completed'));
    
    const [failedResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(eq(submissions.status, 'failed'));
    
    // Get count of submissions in the last hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    
    const [lastHourResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(gt(submissions.createdAt, oneHourAgo));
    
    // Get count of submissions in the last day
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const [lastDayResult] = await db
      .select({ count: count() })
      .from(submissions)
      .where(gt(submissions.createdAt, oneDayAgo));
    
    return {
      averageProcessingTimeMs: avgResult?.avg || 0,
      totalProcessed: (completedResult?.count || 0) + (failedResult?.count || 0),
      pendingCount: pendingResult?.count || 0,
      processingCount: processingResult?.count || 0,
      completedCount: completedResult?.count || 0,
      failedCount: failedResult?.count || 0,
      lastHourCount: lastHourResult?.count || 0,
      lastDayCount: lastDayResult?.count || 0,
    };
  }

  /**
   * Get performance metrics breakdown by assignment
   */
  async getAssignmentMetrics(assignmentId?: number): Promise<Array<{
    assignmentId: number;
    totalSubmissions: number;
    averageProcessingTime: number | null;
    maxProcessingTime: number | null;
    minProcessingTime: number | null;
  }>> {
    // Base query to get assignment stats
    if (assignmentId) {
      // If assignmentId is provided, filter by it
      return db
        .select({
          assignmentId: submissions.assignmentId,
          totalSubmissions: count(),
          averageProcessingTime: avg(feedback.processingTime),
          maxProcessingTime: max(feedback.processingTime),
          minProcessingTime: min(feedback.processingTime),
        })
        .from(submissions)
        .leftJoin(feedback, eq(submissions.id, feedback.submissionId))
        .where(eq(submissions.assignmentId, assignmentId))
        .groupBy(submissions.assignmentId);
    } else {
      // Otherwise return all assignments
      return db
        .select({
          assignmentId: submissions.assignmentId,
          totalSubmissions: count(),
          averageProcessingTime: avg(feedback.processingTime),
          maxProcessingTime: max(feedback.processingTime),
          minProcessingTime: min(feedback.processingTime),
        })
        .from(submissions)
        .leftJoin(feedback, eq(submissions.id, feedback.submissionId))
        .groupBy(submissions.assignmentId);
    }
  }

  /**
   * Get processing time percentiles for performance analysis
   * This can help identify slow processing cases
   */
  async getProcessingTimePercentiles(): Promise<{
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  }> {
    // This is a simplified implementation - in a real system you would use SQL percentile functions
    // For PostgreSQL, you can use percentile_cont
    const feedbackTimes = await db
      .select({ time: feedback.processingTime })
      .from(feedback)
      .orderBy(feedback.processingTime);
    
    const times = feedbackTimes.map((f: { time: number | null }) => f.time).filter(Boolean) as number[];
    
    if (times.length === 0) {
      return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 };
    }
    
    // Calculate percentiles
    const getPercentile = (arr: number[], p: number) => {
      const index = Math.floor(arr.length * p);
      return arr[Math.min(index, arr.length - 1)];
    };
    
    return {
      p50: getPercentile(times, 0.5),
      p75: getPercentile(times, 0.75),
      p90: getPercentile(times, 0.9),
      p95: getPercentile(times, 0.95),
      p99: getPercentile(times, 0.99),
    };
  }

  /**
   * Get system load for the specified time period
   * Units can be 'hour', 'day', 'week', 'month'
   */
  async getSystemLoad(unit: string = 'day', count: number = 7): Promise<Array<{
    id: number;
    createdAt: Date;
  }>> {
    // This is a placeholder - in a real implementation you'd use window functions or time-series analysis
    const timeAgo = new Date();
    
    switch (unit) {
      case 'hour':
        timeAgo.setHours(timeAgo.getHours() - count);
        break;
      case 'day':
        timeAgo.setDate(timeAgo.getDate() - count);
        break;
      case 'week':
        timeAgo.setDate(timeAgo.getDate() - (count * 7));
        break;
      case 'month':
        timeAgo.setMonth(timeAgo.getMonth() - count);
        break;
      default:
        timeAgo.setDate(timeAgo.getDate() - count);
    }
    
    const submissionData = await db
      .select({
        id: submissions.id,
        createdAt: submissions.createdAt
      })
      .from(submissions)
      .where(gt(submissions.createdAt, timeAgo))
      .orderBy(submissions.createdAt);
    
    return submissionData;
  }
}

// Singleton instance
export const metricsService = new MetricsService();
