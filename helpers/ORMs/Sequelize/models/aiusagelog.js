"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class AiUsageLog extends Model {
        static associate(models) {
            const { AiUsageLog, Tenant } = models;
            AiUsageLog.belongsTo(Tenant, { foreignKey: 'tenant_id', onDelete: 'RESTRICT' });
        }
    }

    AiUsageLog.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            provider_request_id: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true
            },
            prompt_tokens: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            completion_tokens: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            cached_tokens: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            total_tokens: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            model: {
                type: DataTypes.STRING,
                allowNull: false
            },
            estimated_cost: {
                type: DataTypes.DECIMAL(10, 6),
                defaultValue: 0.0,
                allowNull: false
            },
            currency: {
                type: DataTypes.STRING,
                defaultValue: "USD",
                allowNull: false
            },
            pricing_version: {
                type: DataTypes.STRING,
                allowNull: false
            },
            pricing_status: {
                type: DataTypes.ENUM("priced", "unknown_model", "missing_usage"),
                allowNull: false
            },
            request_status: {
                type: DataTypes.ENUM("success", "failed"),
                allowNull: false
            },
            feature_source: {
                type: DataTypes.ENUM("bot_reply", "order_notification", "cart_recovery", "review_request"),
                allowNull: false
            }
        },
        {
            sequelize,
            modelName: "AiUsageLog",
            tableName: "ai_usage_logs",
            underscored: true,
            indexes: [
                {
                    fields: ['tenant_id']
                },
                {
                    fields: ['created_at']
                },
                {
                    fields: ['model']
                },
                {
                    fields: ['feature_source']
                },
                {
                    fields: ['tenant_id', 'created_at']
                },
                {
                    unique: true,
                    fields: ['provider_request_id']
                }
            ]
        }
    );
    return AiUsageLog;
};
