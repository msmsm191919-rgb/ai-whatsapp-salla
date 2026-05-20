"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class MessageLog extends Model {
        static associate(models) {
            const { MessageLog, Tenant } = models;
            MessageLog.belongsTo(Tenant, { foreignKey: 'tenant_id' });
        }
    }

    MessageLog.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            salla_order_id: DataTypes.STRING,
            // Changed ENUMs to STRINGs for flexibility during Dev/Simulation
            direction: DataTypes.STRING, // 'in' or 'out'
            status: DataTypes.STRING,    // 'received', 'sent', etc.
            content: DataTypes.TEXT,
            to_phone: DataTypes.STRING,  // The customer's phone number
            metadata: DataTypes.JSON
        },
        {
            sequelize,
            modelName: "MessageLog",
            tableName: "MessageLogs",
            underscored: true,
        }
    );
    return MessageLog;
};
