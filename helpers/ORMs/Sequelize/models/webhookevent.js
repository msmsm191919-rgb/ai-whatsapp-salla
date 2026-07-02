"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class WebhookEvent extends Model {}

    WebhookEvent.init(
        {
            provider: {
                type: DataTypes.STRING,
                allowNull: false
            },
            event_id: {
                type: DataTypes.STRING,
                allowNull: false
            },
            event_type: DataTypes.STRING,
            store_id: DataTypes.STRING,
            status: {
                type: DataTypes.STRING,
                defaultValue: 'pending' // 'pending', 'processing', 'processed', 'failed', 'dead_letter'
            },
            payload: DataTypes.TEXT, // Encrypted payload at rest
            attempt_count: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            locked_at: DataTypes.DATE,
            last_error: DataTypes.TEXT,
            received_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            processed_at: DataTypes.DATE
        },
        {
            sequelize,
            modelName: "WebhookEvent",
            tableName: "WebhookEvents",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ['provider', 'event_id']
                }
            ]
        }
    );
    return WebhookEvent;
};
