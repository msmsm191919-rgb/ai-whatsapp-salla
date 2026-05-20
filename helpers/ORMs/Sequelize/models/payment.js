"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Payment extends Model {
        static associate(models) {
            const { Payment, Tenant, Plan } = models;
            Payment.belongsTo(Tenant, { foreignKey: 'tenant_id' });
            Payment.belongsTo(Plan, { foreignKey: 'plan_id' });
        }
    }

    Payment.init(
        {
            tenant_id: { type: DataTypes.INTEGER, allowNull: false },
            plan_id: { type: DataTypes.INTEGER, allowNull: false },
            amount: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
                validate: { min: 0 }
            },
            currency: { type: DataTypes.STRING(3), defaultValue: 'SAR' },
            status: {
                type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'),
                defaultValue: 'pending'
            },
            provider: { type: DataTypes.STRING }, // e.g. 'stripe', 'moyasar'
            provider_payment_id: { type: DataTypes.STRING, unique: true }, // Idempotency Key
            metadata: DataTypes.JSON
        },
        {
            sequelize,
            modelName: "Payment",
            tableName: "payments",
            underscored: true,
            indexes: [
                { fields: ['tenant_id', 'created_at'] },
                { fields: ['status', 'created_at'] }
            ]
        }
    );
    return Payment;
};
