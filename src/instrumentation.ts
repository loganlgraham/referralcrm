// Global error handlers to prevent unhandled promise rejections from crashing the process
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      console.error('[fatal] Unhandled Rejection:', reason);
      console.error('Promise:', promise);
      
      // Log additional context if it's a MongoDB error
      if (reason && typeof reason === 'object' && 'name' in reason) {
        const error = reason as { name?: string; message?: string; stack?: string; cause?: unknown };
        if (error.name?.includes('Mongo')) {
          console.error('[fatal] MongoDB connection error - this should be handled gracefully');
          console.error('[fatal] Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause,
          });
          
          // Check for SSL/TLS specific errors
          const errorMessage = error.message || '';
          const isSSLError = errorMessage.includes('SSL') || 
                            errorMessage.includes('TLS') || 
                            errorMessage.includes('tlsv1') ||
                            errorMessage.includes('certificate') ||
                            errorMessage.includes('alert number');
          
          if (isSSLError) {
            console.error('[fatal] MongoDB SSL/TLS connection error detected');
            console.error('[fatal] This may indicate TLS configuration issues or certificate problems');
            console.error('[fatal] Check MONGODB_URI and MONGODB_ALLOW_INVALID_CERTS environment variables');
          }
        }
      }
      
      // In serverless environments (Vercel), don't crash the process
      // The error will be logged and the request will fail gracefully
      // In non-serverless environments, we still want to log but not crash
      // The process should continue to handle other requests
    });

    // Handle uncaught exceptions (less common but important)
    process.on('uncaughtException', (error: Error) => {
      console.error('[fatal] Uncaught Exception:', error);
      console.error('[fatal] Stack:', error.stack);
      
      // For MongoDB-related errors, log additional context
      if (error.name?.includes('Mongo')) {
        console.error('[fatal] MongoDB uncaught exception - connection issue');
        
        // Check for SSL/TLS specific errors
        const errorMessage = error.message || '';
        const isSSLError = errorMessage.includes('SSL') || 
                          errorMessage.includes('TLS') || 
                          errorMessage.includes('tlsv1') ||
                          errorMessage.includes('certificate') ||
                          errorMessage.includes('alert number');
        
        if (isSSLError) {
          console.error('[fatal] MongoDB SSL/TLS uncaught exception detected');
          console.error('[fatal] This may indicate TLS configuration issues or certificate problems');
        }
      }
      
      // In serverless environments, we may want to be more lenient
      // but uncaught exceptions are serious and should still exit
      // However, give time for logs to flush
      if (process.env.VERCEL) {
        // In Vercel, let the platform handle the error
        // Don't exit immediately to allow error reporting
        setTimeout(() => {
          process.exit(1);
        }, 2000);
      } else {
        // In other environments, exit after logging
        setTimeout(() => {
          process.exit(1);
        }, 1000);
      }
    });
  }
}