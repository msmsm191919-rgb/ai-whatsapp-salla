"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class EmailOutbox extends Model {
        static associate(models) {
            EmailOutbox.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
        }
    }
    EmailOutbox.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            template: {
                type: DataTypes.STRING,
                allowNull: false
            },
            recipient: {
                type: DataTypes.STRING,
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM('pending', 'sent', 'failed', 'missing_recipient'),
                defaultValue: 'pending',
                allowNull: false
            },
            attempts: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            scheduled_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false
            },
            sent_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            last_error_redacted: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            idempotency_key: {
                type: DataTypes.STRING,
                allowNull: true
            }
        },
        {
            sequelize,
            modelName: "EmailOutbox",
            tableName: "EmailOutbox",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ['tenant_id', 'template']
                },
                {
                    fields: ['status']
                }
            ]
        }
    );
    return EmailOutbox;
};
