package com.doordripp.doordripp.service;

import com.doordripp.doordripp.model.*;
import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.repository.OrderRepository;
import com.doordripp.doordripp.repository.ProductRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final CustomerRepository customerRepository;
    private final ProductRepository productRepository;

    public OrderService(OrderRepository orderRepository, CustomerRepository customerRepository, ProductRepository productRepository) {
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
        this.productRepository = productRepository;
    }

    @Transactional
    public PurchaseOrder placeOrder(Long customerId, List<OrderItem> items) {
        Customer customer = customerRepository.findById(customerId).orElseThrow(() -> new IllegalArgumentException("Invalid customer"));

        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : items) {
            Product product = productRepository.findById(item.getProduct().getId())
                    .orElseThrow(() -> new IllegalArgumentException("Invalid product"));
            item.setPrice(product.getPrice());
            total = total.add(product.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
            // reduce stock (simple logic)
            product.setStock(product.getStock() - item.getQuantity());
            productRepository.save(product);
        }

        PurchaseOrder order = new PurchaseOrder();
        order.setCustomer(customer);
        order.setItems(items);
        order.setTotal(total);

        return orderRepository.save(order);
    }
}
