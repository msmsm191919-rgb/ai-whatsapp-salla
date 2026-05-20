const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    const Campaign = sequelize.define('Campaign', {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        tenant_id: {
            type: DataTypes.BIGINT,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('draft', 'scheduled', 'processing', 'completed', 'failed', 'paused'),
            defaultValue: 'draft'
        },
        scheduled_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        message_body: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        media_url: {
            type: DataTypes.STRING,
            allowNull: true
        },
        target_group: {
            type: DataTypes.STRING, // e.g. 'all', 'vip', 'abandoned_cart'
            defaultValue: 'all'
        },
        stats_total: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        stats_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        stats_read: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        stats_failed: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        tableName: 'campaigns',
        timestamps: true,
        underscored: true
    });

    Campaign.associate = (models) => {
        Campaign.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    };

    return Campaign;
};
