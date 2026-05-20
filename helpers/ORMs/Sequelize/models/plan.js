"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Plan extends Model {
        static associate(models) {
            // One Plan has many Subscriptions
            const { Plan, Subscription } = models;
            Plan.hasMany(Subscription, { foreignKey: 'plan_id' });
        }
    }

    Plan.init(
        {
            name: {
                type: DataTypes.STRING,
                unique: true
            },
            price_monthly: DataTypes.DECIMAL(10, 2),
            price_yearly: DataTypes.DECIMAL(10, 2),
            msg_limit_monthly: DataTypes.INTEGER,
            trial_days: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            features: DataTypes.JSON, // Stores: { whatsapp_count: 1, scenarios: 'basic', etc }
            is_active: {
                type: DataTypes.BOOLEAN,
                defaultValue: true
            },
            ai_model_config: DataTypes.JSON
        },
        {
            sequelize,
            modelName: "Plan",
            tableName: "Plans",
            underscored: true,
            timestamps: false // Plans are lookup tables, timestamps not strictly needed usually, but can be kept. Setting false for simplicity as lookup.
        }
    );
    return Plan;
};
