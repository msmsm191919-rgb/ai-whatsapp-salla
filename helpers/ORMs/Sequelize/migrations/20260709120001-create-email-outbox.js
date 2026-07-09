"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableExists = await queryInterface.tableExists("EmailOutbox");
    if (!tableExists) {
      await queryInterface.createTable("EmailOutbox", {
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
          onDelete: "CASCADE"
        },
        template: {
          type: Sequelize.STRING,
          allowNull: false
        },
        recipient: {
          type: Sequelize.STRING,
          allowNull: false
        },
        status: {
          type: Sequelize.STRING,
          defaultValue: "pending",
          allowNull: false
        },
        attempts: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
          allowNull: false
        },
        scheduled_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        sent_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        last_error_redacted: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        idempotency_key: {
          type: Sequelize.STRING,
          allowNull: true,
          unique: true
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

      // Unique index to prevent duplicate welcome emails
      await queryInterface.addIndex("EmailOutbox", ["tenant_id", "template"], {
        unique: true,
        name: "uq_tenant_template"
      });

      // Index on status
      await queryInterface.addIndex("EmailOutbox", ["status"], {
        name: "idx_email_outbox_status"
      });
      console.log("✅ Table EmailOutbox created successfully.");
    } else {
      console.log("⚠️ Table EmailOutbox already exists. Baseline schema matched, skipping creation.");
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("EmailOutbox");
  }
};
