"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class TenantLoginToken extends Model {
        static associate(models) {
            TenantLoginToken.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
        }
    }
    TenantLoginToken.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            token_hash: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true
            },
            purpose: {
                type: DataTypes.STRING,
                defaultValue: "login",
                allowNull: false
            },
            expires_at: {
                type: DataTypes.DATE,
                allowNull: false
            },
            used_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            revoked_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        },
        {
            sequelize,
            modelName: "TenantLoginToken",
            tableName: "TenantLoginTokens",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ['token_hash']
                },
                {
                    fields: ['tenant_id', 'purpose', 'expires_at']
                }
            ]
        }
    );
    return TenantLoginToken;
};
