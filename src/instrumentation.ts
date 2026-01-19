// Global error handlers to prevent unhandled promise rejections from crashing the process
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      console.error('[fatal] Unhandled Rejection:', reason);
      console.error('Promise:', promise);
      
      // Log additional context if it's a MongoDB error
      if (reason && typeof reason === 'object' && 'name' in reason) {
        const error = reason as { name?: string; message?: string; stack?: string };
        if (error.name?.includes('Mongo')) {
          console.error('[fatal] MongoDB connection error - this should be handled gracefully');
          console.error('[fatal] Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
        }
      }
      
      // Don't crash the process - let Next.js/Vercel handle the request failure
      // The error will still be logged and the request will fail, but the process won't exit
    });

    // Handle uncaught exceptions (less common but important)
    process.on('uncaughtException', (error: Error) => {
      console.error('[fatal] Uncaught Exception:', error);
      console.error('[fatal] Stack:', error.stack);
      
      // For MongoDB-related errors, log additional context
      if (error.name?.includes('Mongo')) {
        console.error('[fatal] MongoDB uncaught exception - connection issue');
      }
      
      // Still exit for uncaught exceptions as they indicate a serious problem
      // But log everything first
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });
  }
}