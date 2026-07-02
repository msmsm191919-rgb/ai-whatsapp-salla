"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class SallaOAuth extends Model {
        static associate(models) {
            const { SallaOAuth, Tenant } = models;
            SallaOAuth.belongsTo(Tenant, { foreignKey: 'tenant_id' });
        }
    }

    SallaOAuth.init(
        {
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Tenants',
                    key: 'id'
                }
            },
            access_token: {
                type: DataTypes.TEXT,
                get() {
                    const rawValue = this.getDataValue('access_token');
                    if (!rawValue) return null;
                    // If it is legacy plaintext (doesn't start with v1:), we return it raw so migration can run.
                    if (!rawValue.startsWith('v1:')) return rawValue;
                    const cryptoHelper = require('../../../cryptoHelper');
                    return cryptoHelper.decrypt(rawValue, this.getDataValue('tenant_id'), 'access_token');
                },
                set(value) {
                    if (!value) {
                        this.setDataValue('access_token', null);
                        return;
                    }
                    if (value.startsWith('v1:')) {
                        this.setDataValue('access_token', value);
                        return;
                    }
                    const cryptoHelper = require('../../../cryptoHelper');
                    this.setDataValue('access_token', cryptoHelper.encrypt(value, this.getDataValue('tenant_id'), 'access_token'));
                }
            },
            refresh_token: {
                type: DataTypes.TEXT,
                get() {
                    const rawValue = this.getDataValue('refresh_token');
                    if (!rawValue) return null;
                    if (!rawValue.startsWith('v1:')) return rawValue;
                    const cryptoHelper = require('../../../cryptoHelper');
                    return cryptoHelper.decrypt(rawValue, this.getDataValue('tenant_id'), 'refresh_token');
                },
                set(value) {
                    if (!value) {
                        this.setDataValue('refresh_token', null);
                        return;
                    }
                    if (value.startsWith('v1:')) {
                        this.setDataValue('refresh_token', value);
                        return;
                    }
                    const cryptoHelper = require('../../../cryptoHelper');
                    this.setDataValue('refresh_token', cryptoHelper.encrypt(value, this.getDataValue('tenant_id'), 'refresh_token'));
                }
            },
            expires_in: DataTypes.DATE,
            expires_at: DataTypes.DATE,
            meta: DataTypes.JSON  // { platform: 'salla'|'zid'|'shopify', authorization, ... }
        },
        {
            sequelize,
            modelName: "SallaOAuth",
            tableName: "SallaOAuth",
            underscored: true,
        }
    );
    return SallaOAuth;
};
