const express = require('express');
const router = express.Router();
const AIService = require('../services/aiService');
const PricingService = require('../services/pricingService');
const axios = require('axios');

// POST /webhook/ghl - Main GHL webhook endpoint
router.post('/ghl', async (req, res) => {
  try {
    console.log('📨 Received GHL webhook');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // Quick validation
    if (!req.body) {
      return res.status(400).json({ error: 'No data received' });
    }
    
    // Extract message data using REAL GHL webhook structure
    const messageData = extractGHLMessageData(req.body);
    
    console.log('📋 Extracted message data:', {
      contact_id: messageData.contact_id,
      contact_name: messageData.contact_name,
      message_type: messageData.message_type,
      content_preview: messageData.content?.substring(0, 50) + '...',
      media_url: messageData.media_url ? 'Present' : 'None',
      channel: messageData.channel,
      detection_method: messageData.detection_method
    });
    
    // Quick response to GHL (important - respond within 30 seconds!)
    res.status(200).json({ 
      status: 'received', 
      message: 'Processing your request...',
      contact_id: messageData.contact_id,
      message_type: messageData.message_type,
      timestamp: new Date().toISOString()
    });
    
    // Process message asynchronously (non-blocking)
    processMessageAsync(messageData);
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Internal error', details: error.message });
  }
});

// 🎯 ACCURATE GHL MESSAGE DATA EXTRACTION
function extractGHLMessageData(body) {
  console.log('🔍 Parsing GHL webhook with real structure...');
  
  // Extract contact information - prioritize customData since it's explicitly set
  const contact = body.contact || {};
  const message = body.message || {};
  
  // Basic data extraction
  const baseData = {
    // Contact information - use customData first, then fallback
    contact_id: body.customData?.contact_id || contact.id || body.contactId || body.contact_id,
    contact_name: body.customData?.contact_name || body.full_name || contact.name || contact.firstName || contact.fullName || 'Customer',
    contact_phone: body.customData?.contact_phone || contact.phone || contact.phoneNumber || '',
    contact_email: body.customData?.contact_email || contact.email || '',
    
    // Message metadata
    message_id: message.id,
    conversation_id: body.customData?.conversation_id || body.conversation?.id || body.conversationId || '',
    location_id: body.location?.id || body.locationId || 'hij5g6beL7ebCFVa1fyq',
    
    // Channel information - extract from attributionSource
    channel: body.customData?.channel || 
             body.contact?.attributionSource?.medium || 
             body.contact?.lastAttributionSource?.medium || 
             body.channel || 
             body.source || 
             message.source || 
             'SMS',
    
    // Timestamps
    timestamp: body.customData?.timestamp || body.timestamp || message.dateAdded || body.date_created || new Date().toISOString(),
    
    // Raw data for debugging
    raw_data: body
  };
  
  // 🚀 PARSE MESSAGE CONTENT USING REAL GHL STRUCTURE
  const messageAnalysis = parseGHLMessage(message, body.customData);
  
  return {
    ...baseData,
    ...messageAnalysis
  };
}

// 🎯 REAL GHL MESSAGE PARSER
function parseGHLMessage(message, customData) {
  console.log('📱 Analyzing message type:', message.type);
  console.log('📎 Message body:', message.body);
  console.log('🔍 Debug attachments URL:', customData?.debug_has_attachments);
  
  // Get message content from multiple sources
  const content = customData?.message_text || message.body || message.text || '';
  
  // ✅ CASE 1: Check for media URL in debug_has_attachments (VOICE/IMAGE)
  const mediaUrl = customData?.debug_has_attachments || customData?.media_url || customData?.attachment_url || '';
  
  if (mediaUrl && mediaUrl.trim() && mediaUrl !== '[object Object]') {
    console.log('🎵 Found media URL:', mediaUrl);
    
    // Determine media type from URL extension
    let messageType = 'voice'; // Default to voice
    let detectionMethod = 'debug_attachments_voice';
    
    if (mediaUrl.includes('.jpg') || mediaUrl.includes('.jpeg') || mediaUrl.includes('.png') || mediaUrl.includes('.gif')) {
      messageType = 'image';
      detectionMethod = 'debug_attachments_image';
    }
    // ALL audio/video files (.mp4, .mov, .avi, .ogg, .wav, etc.) are treated as 'voice' for audio extraction
    else if (mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') || mediaUrl.includes('.avi') || 
             mediaUrl.includes('.ogg') || mediaUrl.includes('.wav') || mediaUrl.includes('.m4a') ||
             mediaUrl.includes('.webm') || mediaUrl.includes('.3gp')) {
      messageType = 'voice';
      detectionMethod = 'debug_attachments_voice_from_video';
    }
    
    console.log(`✅ Detected: ${messageType.toUpperCase()} from URL`);
    
    return {
      message_type: messageType,
      content: content || '',
      media_url: mediaUrl,
      attachments: message.attachments || [],
      detection_method: detectionMethod
    };
  }
  
  // ✅ CASE 2: TEXT MESSAGE (type can be numeric like 18 or string "text")
  if (content && content.trim()) {
    console.log('✅ Detected: TEXT message with content');
    return {
      message_type: "text",
      content: content.trim(),
      media_url: '',
      attachments: message.attachments || [],
      detection_method: 'ghl_text_content_found'
    };
  }
  
  // ✅ CASE 3: Check for attachments in message object
  const attachments = message.attachments || [];
  if (attachments.length > 0) {
    const primaryAttachment = attachments[0];
    const attachmentType = primaryAttachment.type;
    const attachmentUrl = primaryAttachment.url;
    
    console.log(`✅ Detected: ${attachmentType?.toUpperCase() || 'UNKNOWN'} attachment`);
    console.log('🔗 Media URL:', attachmentUrl);
    
    // Map attachment types to our message types - ALL audio/video treated as voice
    let messageType;
    switch (attachmentType) {
      case 'image':
        messageType = 'image';
        break;
      case 'audio':
      case 'video':  // Video files processed as voice (audio extraction)
        messageType = 'voice';
        break;
      default:
        messageType = 'voice'; // Default to voice for unknown media types
    }
    
    return {
      message_type: messageType,
      content: content || '',
      media_url: attachmentUrl,
      attachments: attachments,
      detection_method: 'ghl_attachment_found',
      attachment_type: attachmentType
    };
  }
  
  // ✅ CASE 4: Check if attachments_count indicates media exists
  const attachmentsCount = parseInt(customData?.attachments_count || '0');
  if (attachmentsCount > 0) {
    console.log(`🎵 Attachments detected (count: ${attachmentsCount}) but no URL - likely voice/image`);
    return {
      message_type: 'voice', // Default assumption for missing attachment URL
      content: content || '',
      media_url: '',
      attachments: [],
      detection_method: 'attachments_count_fallback'
    };
  }
  
  // ✅ FALLBACK: No content or attachments
  console.log('⚠️ No content or attachments found');
  return {
    message_type: "text",
    content: '',
    media_url: '',
    attachments: [],
    detection_method: 'ghl_empty_message'
  };
}

// Async message processing function
async function processMessageAsync(messageData) {
  try {
    console.log('🔄 Processing message for contact:', messageData.contact_id);
    console.log('📱 Message type:', messageData.message_type);
    console.log('🔍 Detection method:', messageData.detection_method);
    console.log('📺 Channel:', messageData.channel);
    console.log('💬 Content preview:', messageData.content?.substring(0, 100));
    console.log('🎵 Media URL:', messageData.media_url ? 'Present' : 'None');
    
    // Validate essential data
    if (!messageData.content && !messageData.media_url) {
      console.log('⚠️ No message content or media found, skipping processing');
      return;
    }
    
    if (!messageData.contact_id) {
      console.log('⚠️ No contact_id found, cannot send response');
      return;
    }
    
    // Skip only if we have no content AND no media
    // All media files (including MP4 video) are processed as 'voice' for audio extraction
    
    // Step 1: Get pricing data
    console.log('📊 Fetching pricing data...');
    const pricingData = await PricingService.getPricingData();
    
    // Step 2: Process with AI
    console.log('🤖 Processing with AI...');
    const aiResult = await AIService.processMessage(
      messageData.content,           // Text content or empty string for media
      messageData.message_type,      // 'text', 'image', or 'voice'
      messageData.media_url,         // URL for image/voice or empty string
      pricingData,
      {
        contact_id: messageData.contact_id,
        full_name: messageData.contact_name,
        phone: messageData.contact_phone,
        email: messageData.contact_email
      }
    );
    
    console.log('✅ AI processing completed:', {
      response_length: aiResult.customer_response?.length,
      classification: aiResult.classification,
      language: aiResult.classification?.language,
      original_type: messageData.message_type
    });
    
    // Step 3: Send response back to customer (only if AI generated a response)
    if (aiResult.customer_response && aiResult.customer_response.trim()) {
      console.log('📤 Sending customer response...');
      await sendGHLResponse(messageData, aiResult.customer_response);
      console.log('✅ Message processing completed successfully');
    } else {
      console.log('⚠️ No AI response generated, not sending message');
    }
    
  } catch (error) {
    console.error('❌ Message processing error:', error);
    // No fallback - just log the error and end
    console.log('🔚 Processing ended due to error - no fallback message sent');
  }
}

// Send response via GHL API
async function sendGHLResponse(messageData, responseText) {
  try {
    // Determine the correct message type based on channel
    let messageType;
    
    const channel = messageData.channel?.toLowerCase() || '';
    
    if (channel.includes('instagram') || messageData.raw_data?.contact?.attributionSource?.medium === 'instagram') {
      messageType = "IG";  // Instagram
    } else if (channel.includes('facebook') || channel.includes('messenger')) {
      messageType = "FB";  // Facebook Messenger  
    } else if (channel.includes('whatsapp')) {
      messageType = "WhatsApp";  // WhatsApp
    } else if (channel.includes('sms')) {
      messageType = "SMS";  // SMS
    } else {
      messageType = "SMS";  // Default fallback
    }

    console.log('📤 Sending GHL message:', {
      contactId: messageData.contact_id,
      channel: messageData.channel,
      messageType: messageType,
      messageLength: responseText.length
    });

    const messagePayload = {
      type: messageType,
      contactId: messageData.contact_id,
      locationId: messageData.location_id,
      message: responseText
    };

    const response = await axios.post('https://services.leadconnectorhq.com/conversations/messages', 
      messagePayload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15'
        },
        timeout: 30000
      }
    );
    
    console.log('✅ Message sent successfully via', messageType);
    return response.data;
    
  } catch (error) {
    console.error('❌ Failed to send GHL message:', error.response?.data || error.message);
    throw error;
  }
}

// POST /webhook/test - Test endpoint with real GHL format
router.post('/test', async (req, res) => {
  console.log('🧪 Test webhook received:', req.body);
  
  const testType = req.body.test_type || 'text';
  
  let mockGHLPayload;
  
  if (testType === 'text') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_contact_123",
        name: "Test User",
        phone: "+1234567890",
        email: "test@example.com"
      },
      message: {
        id: "msg_text_123",
        type: "text",
        text: req.body.message || "Hello, my iPhone 13 battery needs replacement. How much?",
        attachments: []
      },
      channel: req.body.channel || "SMS",
      locationId: "hij5g6beL7ebCFVa1fyq"
    };
  } else if (testType === 'image') {
    mockGHLPayload = {
      type: "InboundMessage", 
      contact: {
        id: "test_contact_image_123",
        name: "Image Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_image_123",
        type: "attachment",
        text: "",
        attachments: [
          {
            type: "image",
            url: req.body.media_url || "https://example.com/broken_phone.jpg"
          }
        ]
      },
      channel: req.body.channel || "WhatsApp"
    };
  } else if (testType === 'voice') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_contact_voice_123", 
        name: "Voice Test User",
        phone: "+1234567890"
      },
      message: {
        id: "msg_voice_123",
        type: "attachment",
        text: "",
        attachments: [
          {
            type: "audio",
            url: req.body.media_url || "https://example.com/voice_message.ogg"
          }
        ]
      },
      channel: req.body.channel || "WhatsApp"
    };
  } else if (testType === 'video') {
    mockGHLPayload = {
      type: "InboundMessage",
      contact: {
        id: "test_contact_video_123",
        name: "Video Test User"
      },
      message: {
        id: "msg_video_123", 
        type: "attachment",
        text: "",
        attachments: [
          {
            type: "video",
            url: "https://example.com/repair_video.mp4"
          }
        ]
      },
      channel: "WhatsApp"
    };
  }
  
  // Process test message using real GHL format
  const messageData = extractGHLMessageData(mockGHLPayload);
  processMessageAsync(messageData);
  
  res.json({ 
    status: `${testType} test message processing started`,
    message: 'Check console for processing results',
    test_type: testType,
    mock_payload: mockGHLPayload,
    parsed_data: messageData
  });
});

// GET /webhook/status - Check webhook status
router.get('/status', (req, res) => {
  res.json({
    status: 'active',
    timestamp: new Date().toISOString(),
    endpoints: {
      main: '/webhook/ghl',
      test: '/webhook/test',
      status: '/webhook/status'
    },
    services: {
      ai: 'AIService loaded',
      pricing: 'PricingService loaded',
      ghl_api: 'Direct API calls'
    },
    message_types_supported: ['text', 'image', 'voice'],
    message_types_processed_as_voice: ['mp4', 'mov', 'avi', 'ogg', 'wav', 'm4a', 'webm', '3gp'],
    note: 'All audio and video files are processed as voice for audio extraction',
    features_removed: ['contact_tags', 'opportunities', 'fallback_messages'],
    ghl_structure: 'Real webhook format with debug_has_attachments support',
    detection_methods: ['debug_attachments_voice', 'debug_attachments_image', 'debug_attachments_video', 'ghl_text_content_found', 'ghl_attachment_found'],
    environment: {
      node_env: process.env.NODE_ENV,
      has_ghl_key: !!process.env.GHL_API_KEY,
      has_openai_key: !!process.env.OPENAI_API_KEY
    }
  });
});

// GET /webhook/health - Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    version: '6.1.0-audio-extraction-fixed'
  });
});

module.exports = router;