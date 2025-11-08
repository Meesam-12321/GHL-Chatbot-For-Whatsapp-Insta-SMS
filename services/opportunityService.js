const axios = require('axios');

class OpportunityService {
  constructor() {
    this.apiKey = process.env.GHL_API_KEY;
    this.baseUrl = 'https://services.leadconnectorhq.com';
    this.apiVersion = '2021-07-28';
    
    // Cache for pipeline info to avoid repeated API calls
    this.pipelineCache = null;
    this.cacheExpiry = null;
    this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Update opportunity stage for a contact
   * @param {string} contactId - GHL contact ID
   * @param {string} targetStageName - Name of target stage (e.g., "IA Diagnostico enviado")
   * @param {string} locationId - GHL location ID (required for API calls)
   * @returns {Promise<boolean>} - Success status
   */
  async updateStage(contactId, targetStageName = 'IA Diagnostico enviado', locationId = null) {
    try {
      if (!contactId) {
        console.log('⚠️ OpportunityService: No contact ID provided');
        return false;
      }

      if (!locationId) {
        console.log('⚠️ OpportunityService: No location ID provided');
        return false;
      }

      console.log(`📋 OpportunityService: Moving contact ${contactId} to stage "${targetStageName}" in location ${locationId}`);

      // Step 1: Find existing opportunity for this contact
      const opportunity = await this._findExistingOpportunity(contactId, locationId);
      if (!opportunity) {
        console.error('❌ OpportunityService: No existing opportunity found for contact');
        return false;
      }

      console.log(`🎯 OpportunityService: Found existing opportunity: ${opportunity.id}`);

      // Step 2: Get pipeline info to find target stage
      const pipelineInfo = await this._getPipelineInfo(locationId);
      if (!pipelineInfo) {
        console.error('❌ OpportunityService: Could not get pipeline information');
        return false;
      }

      // Step 3: Find target stage
      const targetStage = this._findStageByName(pipelineInfo.stages, targetStageName);
      if (!targetStage) {
        console.error(`❌ OpportunityService: Stage "${targetStageName}" not found`);
        console.log('Available stages:', pipelineInfo.stages.map(s => s.name));
        return false;
      }

      // Step 4: Update opportunity stage
      const success = await this._updateOpportunityStage(opportunity.id, targetStage.id);
      
      if (success) {
        console.log(`✅ OpportunityService: Successfully moved to stage "${targetStage.name}"`);
        return true;
      } else {
        console.error('❌ OpportunityService: Failed to update opportunity stage');
        return false;
      }

    } catch (error) {
      console.error('❌ OpportunityService: Unexpected error in updateStage:', error.message);
      return false;
    }
  }

  /**
   * Find existing opportunity for contact using Search API
   * @private
   * @param {string} contactId - GHL contact ID
   * @param {string} locationId - GHL location ID
   * @returns {Promise<Object|null>} - Opportunity object or null
   */
  async _findExistingOpportunity(contactId, locationId) {
    try {
      console.log(`🔍 OpportunityService: Searching for existing opportunity for contact ${contactId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/opportunities/search`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Version': this.apiVersion
          },
          params: {
            location_id: locationId,
            contact_id: contactId,
            status: 'open',
            limit: 1  // We only need the first/most recent one
          },
          timeout: 10000
        }
      );
      
      if (response.data.opportunities && response.data.opportunities.length > 0) {
        const opportunity = response.data.opportunities[0];
        console.log(`📋 OpportunityService: Found existing opportunity: ${opportunity.id} (${opportunity.name})`);
        return opportunity;
      }
      
      console.log('⚠️ OpportunityService: No existing opportunity found for this contact');
      return null;
      
    } catch (error) {
      console.error('❌ OpportunityService: Failed to search for opportunities:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get pipeline and stage information using Get Pipelines API
   * @private
   * @param {string} locationId - GHL location ID
   * @returns {Promise<Object|null>} - Pipeline info with stages
   */
  async _getPipelineInfo(locationId) {
    try {
      // Check cache first
      if (this.pipelineCache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
        console.log('📋 OpportunityService: Using cached pipeline info');
        return this.pipelineCache;
      }

      console.log('📋 OpportunityService: Fetching pipeline information...');
      
      // Get all pipelines for this location
      const pipelinesResponse = await axios.get(
        `${this.baseUrl}/opportunities/pipelines`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Version': this.apiVersion
          },
          params: {
            locationId: locationId
          },
          timeout: 10000
        }
      );
      
      // Find repair pipeline (ReparaloYA Ventas)
      const repairPipeline = pipelinesResponse.data.pipelines.find(p => 
        p.name.includes('ReparaloYA') || 
        p.name.includes('Ventas') ||
        p.name.toLowerCase().includes('repair')
      );
      
      if (!repairPipeline) {
        console.error('❌ OpportunityService: Repair pipeline not found');
        console.log('Available pipelines:', pipelinesResponse.data.pipelines.map(p => p.name));
        return null;
      }

      console.log('🎯 OpportunityService: Found repair pipeline:', repairPipeline.name);
      
      // The pipeline object should contain stages already
      // If not, we might need to make another API call to get stages
      let stages = repairPipeline.stages || [];
      
      // If no stages in pipeline object, try to get them separately (fallback)
      if (stages.length === 0) {
        console.log('📋 OpportunityService: No stages in pipeline object, trying separate call...');
        try {
          const stagesResponse = await axios.get(
            `${this.baseUrl}/opportunities/pipelines/${repairPipeline.id}/stages`,
            {
              headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Version': this.apiVersion
              },
              timeout: 10000
            }
          );
          stages = stagesResponse.data.stages || [];
        } catch (stageError) {
          console.log('⚠️ OpportunityService: Could not fetch stages separately, using pipeline stages');
        }
      }
      
      const pipelineInfo = {
        pipeline: repairPipeline,
        stages: stages
      };

      // Cache the result
      this.pipelineCache = pipelineInfo;
      this.cacheExpiry = Date.now() + this.cacheTimeout;
      
      console.log('📋 OpportunityService: Pipeline stages:', stages.map(s => s.name));
      return pipelineInfo;
      
    } catch (error) {
      console.error('❌ OpportunityService: Failed to get pipeline info:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Find stage by name (fuzzy matching)
   * @private
   * @param {Array} stages - Array of stage objects
   * @param {string} targetName - Target stage name
   * @returns {Object|null} - Stage object or null
   */
  _findStageByName(stages, targetName) {
    if (!stages || stages.length === 0) return null;

    const normalizedTarget = targetName.toLowerCase();
    
    // Try exact match first
    let stage = stages.find(s => s.name.toLowerCase() === normalizedTarget);
    if (stage) {
      console.log(`📋 OpportunityService: Found stage via exact match: ${stage.name}`);
      return stage;
    }

    // Try partial matches for common variations
    const partialMatches = [
      'ia diagnostico',
      'diagnostico enviado', 
      'ai diagnosis',
      'diagnosis sent'
    ];

    for (const partial of partialMatches) {
      stage = stages.find(s => s.name.toLowerCase().includes(partial));
      if (stage) {
        console.log(`📋 OpportunityService: Found stage via partial match: ${stage.name}`);
        return stage;
      }
    }

    console.error(`❌ OpportunityService: No stage found matching "${targetName}"`);
    return null;
  }

  /**
   * Update opportunity stage using Update Opportunity API
   * @private
   * @param {string} opportunityId - Opportunity ID
   * @param {string} stageId - Stage ID
   * @returns {Promise<boolean>} - Success status
   */
  async _updateOpportunityStage(opportunityId, stageId) {
    try {
      console.log(`📋 OpportunityService: Updating opportunity ${opportunityId} to stage ${stageId}`);
      
      const response = await axios.put(
        `${this.baseUrl}/opportunities/${opportunityId}`,
        {
          pipelineStageId: stageId,
          status: 'open'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': this.apiVersion
          },
          timeout: 10000
        }
      );
      
      const success = response.status >= 200 && response.status < 300;
      
      if (success) {
        console.log('✅ OpportunityService: Opportunity stage updated successfully');
      }
      
      return success;
      
    } catch (error) {
      console.error('❌ OpportunityService: Failed to update opportunity stage:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Get detailed pipeline information for debugging
   * @param {string} locationId - GHL location ID
   * @returns {Promise<Object>} - Detailed pipeline info
   */
  async getDetailedPipelineInfo(locationId = null) {
    try {
      // Use locationId if provided, otherwise try to get from environment
      const locId = locationId || process.env.GHL_LOCATION_ID;
      if (!locId) {
        return {
          success: false,
          error: 'No location ID provided',
          pipeline: null,
          stages: [],
          stageNames: []
        };
      }

      const info = await this._getPipelineInfo(locId);
      return {
        success: !!info,
        pipeline: info?.pipeline || null,
        stages: info?.stages || [],
        stageNames: info?.stages?.map(s => s.name) || [],
        cached: !!(this.pipelineCache && this.cacheExpiry && Date.now() < this.cacheExpiry),
        locationId: locId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        pipeline: null,
        stages: [],
        stageNames: [],
        locationId: locationId
      };
    }
  }

  /**
   * Clear pipeline cache
   */
  clearCache() {
    this.pipelineCache = null;
    this.cacheExpiry = null;
    console.log('🗑️ OpportunityService: Cache cleared');
  }

  /**
   * Health check for OpportunityService
   * @returns {Object} - Service health status
   */
  getHealthStatus() {
    return {
      service: 'OpportunityService',
      status: this.apiKey ? 'ready' : 'missing_api_key',
      hasApiKey: !!this.apiKey,
      baseUrl: this.baseUrl,
      hasCachedData: !!this.pipelineCache,
      cacheExpiry: this.cacheExpiry,
      locationId: process.env.GHL_LOCATION_ID || 'missing',
      strategy: 'search_existing_opportunities',
      apis_used: ['Search Opportunity', 'Get Pipelines', 'Update Opportunity'],
      version: '3.0.0'
    };
  }
}

module.exports = new OpportunityService();