"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class UsageCounter extends Model {
        static associate(models) {
            const { UsageCounter, Tenant } = models;
            UsageCounter.belongsTo(Tenant, { foreignKey: 'tenant_id' });
        }
    }

    UsageCounter.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            period_key: {
                type: DataTypes.STRING, // Format: 'YYYY-MM' e.g., '2026-01'
                allowNull: false
            },
            messages_sent: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                validate: { min: 0 }
            },
            ai_requests: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                validate: { min: 0 }
            }
        },
        {
            sequelize,
            modelName: "UsageCounter",
            tableName: "usage_counters",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ['tenant_id', 'period_key']
                },
                {
                    fields: ['period_key']
                }
            ]
        }
    );
    return UsageCounter;
};
