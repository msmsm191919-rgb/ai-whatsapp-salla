"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class WhatsAppConfig extends Model {
        static associate(models) {
            const { WhatsAppConfig, Tenant } = models;
            WhatsAppConfig.belongsTo(Tenant, { foreignKey: 'tenant_id' });
        }
    }

    WhatsAppConfig.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            phone_number_id: {
                type: DataTypes.STRING,
                unique: true // Meta Phone ID is unique
            },
            waba_id: DataTypes.STRING,
            access_token: DataTypes.TEXT,
            verify_token: DataTypes.STRING,
            phone_number: DataTypes.STRING,
            status: {
                type: DataTypes.ENUM('active', 'pending', 'disconnected'),
                defaultValue: 'pending'
            }
        },
        {
            sequelize,
            modelName: "WhatsAppConfig",
            tableName: "WhatsAppConfigs",
            underscored: true,
        }
    );
    return WhatsAppConfig;
};
