"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Tenant extends Model {
        static associate(models) {
            const { Tenant, Subscription, WhatsAppConfig, SallaOAuth, MessageLog, UsageCounter } = models;

            // Core Relationships (Tenant is the heart of the system)
            Tenant.hasOne(SallaOAuth, { foreignKey: 'tenant_id' });
            Tenant.hasOne(Subscription, { foreignKey: 'tenant_id' });
            Tenant.hasOne(WhatsAppConfig, { foreignKey: 'tenant_id' });
            Tenant.hasMany(MessageLog, { foreignKey: 'tenant_id' });
            Tenant.hasMany(UsageCounter, { foreignKey: 'tenant_id' });
        }
    }

    Tenant.init(
        {
            // tenants.id is the internal TenantID
            salla_merchant_id: {
                type: DataTypes.BIGINT,
                unique: true,
                allowNull: false
            },
            store_name: DataTypes.STRING,
            store_domain: DataTypes.STRING,
            email: DataTypes.STRING,
            status: {
                type: DataTypes.ENUM('active', 'blocked_over_limit', 'blocked_payment', 'suspended_manual', 'degraded_webhook'),
                defaultValue: 'active'
            },
            // Metadata configuration (Flexible JSON for future settings)
            settings: DataTypes.JSON
        },
        {
            sequelize,
            modelName: "Tenant",
            tableName: "Tenants", // Explicit table name
            underscored: true,    // Use snake_case for DB columns (created_at, updated_at)
        }
    );
    return Tenant;
};
