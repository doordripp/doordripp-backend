package com.doordripp.doordripp.service;

import com.doordripp.doordripp.model.*;
import com.doordripp.doordripp.repository.ProductRepository;
import com.doordripp.doordripp.repository.PurchaseOrderRepository;
import com.doordripp.doordripp.repository.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

@Service
public class OrderService {
    private final ProductRepository productRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;
    private final CustomerRepository customerRepository;

    public OrderService(ProductRepository productRepository,
                        PurchaseOrderRepository purchaseOrderRepository,
                        CustomerRepository customerRepository) {
        this.productRepository = productRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.customerRepository = customerRepository;
    }

    /**
     * Places an order for the given customer and order items.
     * Validates stock, reduces product stock, and persists the order and updated products.
     */
    @SuppressWarnings("null")
	@Transactional
    public PurchaseOrder placeOrder(Long customerId, List<OrderItem> items) {
        if (items == null || items.isEmpty()) throw new IllegalArgumentException("Order must have items");

        Customer customer = customerRepository.findById(customerId)
                .orElseThrow(() -> new IllegalArgumentException("Invalid customer"));

        // Validate stock for all items first to avoid partial side effects
        for (OrderItem oi : items) {
            Product product = productRepository.findById(oi.getProduct().getId())
                    .orElseThrow(() -> new IllegalArgumentException("Invalid product: " + oi.getProduct().getId()));

            if (product.getStock() < oi.getQuantity()) {
                throw new IllegalStateException("Insufficient stock for product: " + product.getName());
            }
        }

        // All good — create order and reduce stock
        PurchaseOrder order = new PurchaseOrder();
        order.setCustomer(customer);
        order.setCreatedAt(OffsetDateTime.now());

        BigDecimal total = BigDecimal.ZERO;

        for (OrderItem oi : items) {
            Product product = productRepository.findById(oi.getProduct().getId()).get();

            // reduce stock
            int newStock = product.getStock() - oi.getQuantity();
            product.setStock(newStock);
            productRepository.save(product);

            // set order back-reference and persist relationship via cascade
            oi.setOrder(order);
            oi.setProduct(product); // ensure attached managed entity
            order.getItems().add(oi);

            total = total.add(oi.getPrice().multiply(BigDecimal.valueOf(oi.getQuantity())));
        }

        order.setTotal(total);
        PurchaseOrder saved = purchaseOrderRepository.save(order);

        return saved;
    }
}
