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
            access_token: DataTypes.TEXT,
            refresh_token: DataTypes.TEXT,
            expires_in: DataTypes.DATE
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
