"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Tenant extends Model {
        static associate(models) {
            const { Tenant, Subscription, WhatsAppConfig, SallaOAuth, MessageLog, UsageCounter } = models;

            // Core Relationships (Tenant is the heart of the system)
            Tenant.hasOne(SallaOAuth, { foreignKey: 'tenant_id' });
            Tenant.hasOne(Subscription, { foreignKey: 'tenant_id' });
            // ⚠️ نحتفظ بـ hasOne للتوافق مع الكود القديم (يرجع الرقم الأساسي)
            Tenant.hasOne(WhatsAppConfig, {
                foreignKey: 'tenant_id',
                scope: { is_primary: true }   // hasOne الآن = الرقم الأساسي فقط
            });
            // ✅ الجديد: hasMany لإدارة أرقام متعددة
            Tenant.hasMany(WhatsAppConfig, {
                foreignKey: 'tenant_id',
                as: 'WhatsAppNumbers'
            });
            Tenant.hasMany(MessageLog, { foreignKey: 'tenant_id' });
            Tenant.hasMany(UsageCounter, { foreignKey: 'tenant_id' });
        }
    }

    Tenant.init(
        {
            // tenants.id is the internal TenantID

            // 🌐 منصة التاجر (متعدد المنصات)
            platform: {
                type: DataTypes.ENUM('salla', 'zid', 'shopify', 'standalone'),
                defaultValue: 'salla',
                allowNull: false
            },
            // معرّف المتجر في المنصة الأصلية (Salla merchant_id, Zid store_id, Shopify shop, etc.)
            platform_store_id: {
                type: DataTypes.STRING,
                allowNull: true
            },

            // ⚠️ Legacy — للتوافق مع الكود القديم (Salla merchant id)
            salla_merchant_id: {
                type: DataTypes.BIGINT,
                allowNull: true   // الآن nullable لدعم منصات ثانية
            },

            store_name: DataTypes.STRING,
            store_domain: DataTypes.STRING,
            email: DataTypes.STRING,
            contact_email: DataTypes.STRING,
            contact_phone: DataTypes.STRING,
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
