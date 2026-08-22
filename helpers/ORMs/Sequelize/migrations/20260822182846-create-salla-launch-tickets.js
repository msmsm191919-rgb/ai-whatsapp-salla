"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableExists = await queryInterface.tableExists("SallaLaunchTickets");
    if (!tableExists) {
      await queryInterface.createTable("SallaLaunchTickets", {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        ticket_hash: {
          type: Sequelize.STRING(64),
          allowNull: false,
          unique: true
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
        platform: {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "salla"
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: false
        },
        consumed_at: {
          type: Sequelize.DATE,
          allowNull: true
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

      await queryInterface.addIndex("SallaLaunchTickets", ["ticket_hash"], { name: "idx_salla_launch_tickets_hash", unique: true });
      await queryInterface.addIndex("SallaLaunchTickets", ["tenant_id"], { name: "idx_salla_launch_tickets_tenant_id" });
      await queryInterface.addIndex("SallaLaunchTickets", ["expires_at"], { name: "idx_salla_launch_tickets_expires_at" });

      console.log("✅ Table SallaLaunchTickets created successfully.");
    } else {
      console.log("⚠️ Table SallaLaunchTickets already exists, skipping creation.");
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("SallaLaunchTickets");
  }
};
