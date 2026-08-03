"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableExists = await queryInterface.tableExists("ai_usage_logs");
    if (!tableExists) {
      await queryInterface.createTable("ai_usage_logs", {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        tenant_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: {
            model: "Tenants",
            key: "id"
          },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        provider_request_id: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true
        },
        prompt_tokens: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false
        },
        completion_tokens: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false
        },
        cached_tokens: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false
        },
        total_tokens: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false
        },
        model: {
          type: Sequelize.STRING,
          allowNull: false
        },
        estimated_cost: {
          type: Sequelize.DECIMAL(15, 8),
          defaultValue: 0.00000000,
          allowNull: false
        },
        currency: {
          type: Sequelize.STRING,
          defaultValue: "USD",
          allowNull: false
        },
        pricing_version: {
          type: Sequelize.STRING,
          allowNull: false
        },
        pricing_status: {
          type: Sequelize.ENUM("priced", "unknown_model", "missing_usage"),
          allowNull: false
        },
        request_status: {
          type: Sequelize.ENUM("success", "failed"),
          allowNull: false
        },
        feature_source: {
          type: Sequelize.ENUM("bot_reply", "order_notification", "cart_recovery", "review_request"),
          allowNull: false
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
        }
      });

      // Add indexes
      await queryInterface.addIndex("ai_usage_logs", ["tenant_id"], { name: "idx_ai_logs_tenant_id" });
      await queryInterface.addIndex("ai_usage_logs", ["created_at"], { name: "idx_ai_logs_created_at" });
      await queryInterface.addIndex("ai_usage_logs", ["model"], { name: "idx_ai_logs_model" });
      await queryInterface.addIndex("ai_usage_logs", ["feature_source"], { name: "idx_ai_logs_feature_source" });
      await queryInterface.addIndex("ai_usage_logs", ["tenant_id", "created_at"], { name: "idx_ai_logs_tenant_created" });
      
      console.log("✅ Table ai_usage_logs created successfully.");
    } else {
      console.log("⚠️ Table ai_usage_logs already exists, skipping creation.");
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("ai_usage_logs");
  }
};
