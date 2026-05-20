const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    const Customer = sequelize.define('Customer', {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        tenant_id: {
            type: DataTypes.BIGINT,
            allowNull: false
        },
        salla_customer_id: {
            type: DataTypes.BIGINT, // ID from Salla
            allowNull: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true
        },
        group_name: {
            type: DataTypes.STRING,
            defaultValue: 'Default'
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive', 'blocked'),
            defaultValue: 'active'
        },
        last_order_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        total_orders: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        total_spent: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00
        }
    }, {
        tableName: 'customers',
        timestamps: true,
        underscored: true,
        indexes: [
            {
                unique: true,
                fields: ['tenant_id', 'phone'] // Prevent duplicate phone per tenant
            }
        ]
    });

    Customer.associate = (models) => {
        Customer.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    };

    return Customer;
};
