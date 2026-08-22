"use strict";
const { Model } = require("sequelize");

// One-time, short-lived launch ticket used to hand off a verified Salla Embedded
// App session to the top-level (non-iframe) Mubhir origin. The raw ticket value
// is never stored — only its SHA-256 hash. A ticket is bound to exactly one
// tenant_id at creation time and can be consumed at most once.
module.exports = (sequelize, DataTypes) => {
    class SallaLaunchTicket extends Model {
        static associate(models) {
            const { SallaLaunchTicket, Tenant } = models;
            SallaLaunchTicket.belongsTo(Tenant, { foreignKey: 'tenant_id' });
        }
    }

    SallaLaunchTicket.init(
        {
            ticket_hash: {
                type: DataTypes.STRING(64),
                allowNull: false,
                unique: true
            },
            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Tenants',
                    key: 'id'
                }
            },
            platform: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'salla'
            },
            expires_at: {
                type: DataTypes.DATE,
                allowNull: false
            },
            consumed_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        },
        {
            sequelize,
            modelName: "SallaLaunchTicket",
            tableName: "SallaLaunchTickets",
            underscored: true,
        }
    );
    return SallaLaunchTicket;
};
