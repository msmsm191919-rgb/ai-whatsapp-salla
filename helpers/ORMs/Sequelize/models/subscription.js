"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Subscription extends Model {
        static associate(models) {
            const { Subscription, Tenant, Plan } = models;
            Subscription.belongsTo(Tenant, { foreignKey: 'tenant_id' });
            Subscription.belongsTo(Plan, { foreignKey: 'plan_id' });
        }
    }

    Subscription.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true // One active subscription per tenant logic handled by app/db constraint
            },
            plan_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM('active', 'expired', 'canceled', 'trial', 'past_due'),
                defaultValue: 'trial'
            },
            is_yearly: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            start_date: DataTypes.DATE,
            end_date: DataTypes.DATE,
            // usage_counter removed -> moved to UsageCounter model
        },
        {
            sequelize,
            modelName: "Subscription",
            tableName: "Subscriptions",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ['tenant_id'],
                    where: {
                        status: ['trial', 'active', 'past_due']
                    }
                },
                {
                    fields: ['tenant_id', 'status']
                },
                {
                    fields: ['end_date'] // For cron jobs checking expiry
                }
            ]
        }
    );
    return Subscription;
};
