const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Cart extends Model {
        static associate(models) {
            Cart.belongsTo(models.Tenant, { foreignKey: "tenant_id", onDelete: 'CASCADE' });
            Cart.belongsTo(models.Customer, { foreignKey: "customer_id", onDelete: 'SET NULL' });
        }
    }

    Cart.init({
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        salla_cart_id: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        items: {
            type: DataTypes.JSON, // Array of products {name, price, image}
            allowNull: true,
        },
        total_amount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0.00,
        },
        currency: {
            type: DataTypes.STRING,
            defaultValue: 'SAR'
        },
        checkout_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('abandoned', 'recovered', 'lost'),
            defaultValue: 'abandoned',
        },
        recovery_attempts: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        last_message_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        recovered_at: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: "Cart",
        tableName: "Carts",
        timestamps: true,
        updatedAt: "updated_at",
        createdAt: "created_at",
    });

    return Cart;
};
