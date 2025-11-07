const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Import routes
const webhookRoutes = require('./routes/webhook');

// Routes
app.use('/webhook', webhookRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'GHL Webhook Bot'
  });
});

// Simple in-memory queue to prevent message loss
const messageQueue = [];
let processing = false;

// Process messages sequentially to avoid parallel execution issues
async function processMessageQueue() {
  if (processing || messageQueue.length === 0) return;
  
  processing = true;
  console.log(`📥 Processing queue: ${messageQueue.length} messages`);
  
  while (messageQueue.length > 0) {
    const message = messageQueue.shift();
    try {
      await processMessage(message);
      console.log('✅ Message processed successfully');
    } catch (error) {
      console.error('❌ Error processing message:', error.message);
      // Could add retry logic here if needed
    }
  }
  
  processing = false;
}

// Import message processor
const messageProcessor = require('./messageProcessor');

// Process message using the proper processor
async function processMessage(message) {
  return await messageProcessor.processMessage(message);
}

// Add message to queue
function addToQueue(message) {
  messageQueue.push(message);
  console.log(`📨 Added to queue. Queue length: ${messageQueue.length}`);
  
  // Process queue (non-blocking)
  setImmediate(processMessageQueue);
}

// Make addToQueue available globally
app.locals.addToQueue = addToQueue;

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Server Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 GHL Webhook Bot running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Webhook endpoint: http://localhost:${PORT}/webhook/ghl`);
});

module.exports = app;