const TagService = require('./tagService');
const OpportunityService = require('./opportunityService');

class FaultTolerantProcessor {
  constructor() {
    this.tagService = TagService;
    this.opportunityService = OpportunityService;
  }

  /**
   * Process post-AI actions (tags and pipeline) with fault tolerance
   * @param {string} contactId - GHL contact ID
   * @param {Object} aiClassification - AI classification result
   * @param {Object} options - Additional options (targetStage, locationId)
   * @returns {Promise<Object>} - Results of all operations
   */
  async processPostAIActions(contactId, aiClassification, options = {}) {
    const results = {
      contactId: contactId,
      timestamp: new Date().toISOString(),
      tags: { success: false, error: null, data: null },
      pipeline: { success: false, error: null, data: null },
      overall: { success: false, completedSteps: 0, totalSteps: 2 }
    };

    try {
      console.log('🔄 FaultTolerantProcessor: Starting post-AI processing for contact:', contactId);

      // Step 1: Process tags (independent operation)
      try {
        console.log('🏷️ FaultTolerantProcessor: Processing tags...');
        await this._processTagsWithRetry(contactId, aiClassification, results);
      } catch (error) {
        console.error('❌ FaultTolerantProcessor: Tags processing failed completely:', error.message);
        results.tags.error = `Tag processing failed: ${error.message}`;
      }

      // Step 2: Process pipeline (independent operation)
      try {
        console.log('📋 FaultTolerantProcessor: Processing pipeline...');
        await this._processPipelineWithRetry(contactId, options.targetStage, results, 2, options.locationId);
      } catch (error) {
        console.error('❌ FaultTolerantProcessor: Pipeline processing failed completely:', error.message);
        results.pipeline.error = `Pipeline processing failed: ${error.message}`;
      }

      // Calculate overall success
      results.overall.completedSteps = (results.tags.success ? 1 : 0) + (results.pipeline.success ? 1 : 0);
      results.overall.success = results.overall.completedSteps > 0;

      // Log final results
      const successRate = (results.overall.completedSteps / results.overall.totalSteps) * 100;
      console.log(`✅ FaultTolerantProcessor: Completed with ${successRate}% success rate (${results.overall.completedSteps}/${results.overall.totalSteps} operations)`);

      return results;

    } catch (error) {
      console.error('❌ FaultTolerantProcessor: Critical error in processPostAIActions:', error.message);
      results.overall.error = `Critical processor error: ${error.message}`;
      return results;
    }
  }

  /**
   * Process tags with retry logic
   * @private
   */
  async _processTagsWithRetry(contactId, aiClassification, results, maxRetries = 2) {
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        if (attempt > 0) {
          console.log(`🔄 FaultTolerantProcessor: Retrying tags (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this._wait(1000 * attempt); // Progressive delay
        }

        // Generate tags from classification
        const tags = this.tagService.generateTagsFromClassification(aiClassification);
        
        if (tags.length === 0) {
          console.log('📋 FaultTolerantProcessor: No tags to add, marking as successful');
          results.tags.success = true;
          results.tags.data = { message: 'No tags to add', tagsGenerated: [] };
          return;
        }

        // Add tags to contact
        const tagResult = await this.tagService.addTags(contactId, tags);
        
        if (tagResult) {
          results.tags.success = true;
          results.tags.data = { 
            tagsAdded: tags, 
            apiResponse: tagResult,
            attempt: attempt + 1 
          };
          console.log(`✅ FaultTolerantProcessor: Tags processed successfully on attempt ${attempt + 1}`);
          return;
        } else {
          throw new Error('Tag service returned null/false');
        }

      } catch (error) {
        attempt++;
        console.error(`❌ FaultTolerantProcessor: Tags attempt ${attempt} failed:`, error.message);
        
        if (attempt > maxRetries) {
          results.tags.error = `All tag attempts failed. Last error: ${error.message}`;
          throw error;
        }
      }
    }
  }

  /**
   * Process pipeline with retry logic
   * @private
   */
  async _processPipelineWithRetry(contactId, targetStage = 'IA Diagnostico enviado', results, maxRetries = 2, locationId = null) {
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        if (attempt > 0) {
          console.log(`🔄 FaultTolerantProcessor: Retrying pipeline (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this._wait(1500 * attempt); // Progressive delay
        }

        const pipelineSuccess = await this.opportunityService.updateStage(contactId, targetStage, locationId);
        
        if (pipelineSuccess) {
          results.pipeline.success = true;
          results.pipeline.data = { 
            targetStage: targetStage,
            contactId: contactId,
            locationId: locationId,
            attempt: attempt + 1 
          };
          console.log(`✅ FaultTolerantProcessor: Pipeline processed successfully on attempt ${attempt + 1}`);
          return;
        } else {
          throw new Error('Opportunity service returned false');
        }

      } catch (error) {
        attempt++;
        console.error(`❌ FaultTolerantProcessor: Pipeline attempt ${attempt} failed:`, error.message);
        
        if (attempt > maxRetries) {
          results.pipeline.error = `All pipeline attempts failed. Last error: ${error.message}`;
          throw error;
        }
      }
    }
  }

  /**
   * Process tags only (for when pipeline is not needed)
   * @param {string} contactId - GHL contact ID
   * @param {Object} aiClassification - AI classification result
   * @returns {Promise<boolean>} - Success status
   */
  async processTagsOnly(contactId, aiClassification) {
    try {
      console.log('🏷️ FaultTolerantProcessor: Processing tags only...');
      
      const tags = this.tagService.generateTagsFromClassification(aiClassification);
      if (tags.length === 0) {
        console.log('📋 FaultTolerantProcessor: No tags to process');
        return true;
      }

      const result = await this.tagService.addTags(contactId, tags);
      const success = !!result;
      
      console.log(`${success ? '✅' : '❌'} FaultTolerantProcessor: Tags-only processing ${success ? 'succeeded' : 'failed'}`);
      return success;

    } catch (error) {
      console.error('❌ FaultTolerantProcessor: Tags-only processing failed:', error.message);
      return false;
    }
  }

  /**
   * Process pipeline only (for when tags are not needed)
   * @param {string} contactId - GHL contact ID
   * @param {string} targetStage - Target pipeline stage
   * @returns {Promise<boolean>} - Success status
   */
  async processPipelineOnly(contactId, targetStage = 'IA Diagnostico enviado') {
    try {
      console.log('📋 FaultTolerantProcessor: Processing pipeline only...');
      
      const success = await this.opportunityService.updateStage(contactId, targetStage);
      
      console.log(`${success ? '✅' : '❌'} FaultTolerantProcessor: Pipeline-only processing ${success ? 'succeeded' : 'failed'}`);
      return success;

    } catch (error) {
      console.error('❌ FaultTolerantProcessor: Pipeline-only processing failed:', error.message);
      return false;
    }
  }

  /**
   * Get health status of all services
   * @returns {Object} - Comprehensive health check
   */
  getHealthStatus() {
    return {
      processor: {
        service: 'FaultTolerantProcessor',
        status: 'ready',
        version: '1.0.0'
      },
      dependencies: {
        tagService: this.tagService.getHealthStatus(),
        opportunityService: this.opportunityService.getHealthStatus()
      },
      capabilities: {
        tagProcessing: true,
        pipelineProcessing: true,
        faultTolerance: true,
        retryLogic: true,
        independentOperations: true
      }
    };
  }

  /**
   * Get detailed pipeline information for debugging
   * @returns {Promise<Object>} - Pipeline info
   */
  async getPipelineInfo() {
    try {
      return await this.opportunityService.getDetailedPipelineInfo();
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.opportunityService.clearCache();
    console.log('🗑️ FaultTolerantProcessor: All caches cleared');
  }

  /**
   * Wait helper for delays
   * @private
   * @param {number} ms - Milliseconds to wait
   */
  async _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate input parameters
   * @private
   * @param {string} contactId - Contact ID to validate
   * @param {Object} aiClassification - Classification to validate
   * @returns {Object} - Validation result
   */
  _validateInput(contactId, aiClassification) {
    const errors = [];

    if (!contactId || typeof contactId !== 'string') {
      errors.push('Invalid contact ID');
    }

    if (!aiClassification || typeof aiClassification !== 'object') {
      errors.push('Invalid AI classification');
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }
}

module.exports = new FaultTolerantProcessor();