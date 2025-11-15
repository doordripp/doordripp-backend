package com.doordripp.doordripp.service;

import com.doordripp.doordripp.model.*;
import com.doordripp.doordripp.repository.CartRepository;
import com.doordripp.doordripp.repository.ProductRepository;
import com.doordripp.doordripp.repository.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class CartService {
    private final CartRepository cartRepository;
    private final ProductRepository productRepository;
    private final CustomerRepository customerRepository;
    private final OrderService orderService;

    public CartService(CartRepository cartRepository, ProductRepository productRepository, CustomerRepository customerRepository, OrderService orderService) {
        this.cartRepository = cartRepository;
        this.productRepository = productRepository;
        this.customerRepository = customerRepository;
        this.orderService = orderService;
    }

    public Cart getCartForCustomer(Long customerId) {
        return cartRepository.findByCustomerId(customerId).orElseGet(() -> createCartForCustomer(customerId));
    }

    private Cart createCartForCustomer(Long customerId) {
        Customer customer = customerRepository.findById(customerId).orElseThrow(() -> new IllegalArgumentException("Invalid customer"));
        Cart cart = new Cart();
        cart.setCustomer(customer);
        cart.setTotal(BigDecimal.ZERO);
        return cartRepository.save(cart);
    }

    @Transactional
    public Cart addItem(Long customerId, Long productId, int quantity) {
        if (quantity <= 0) throw new IllegalArgumentException("Quantity must be positive");
        Cart cart = getCartForCustomer(customerId);
        Product product = productRepository.findById(productId).orElseThrow(() -> new IllegalArgumentException("Invalid product"));

        Optional<CartItem> existing = cart.getItems().stream().filter(i -> i.getProduct().getId().equals(productId)).findFirst();
        if (existing.isPresent()) {
            CartItem item = existing.get();
            item.setQuantity(item.getQuantity() + quantity);
            // update price snapshot
            item.setPrice(product.getPrice());
        } else {
            CartItem item = new CartItem();
            item.setProduct(product);
            item.setQuantity(quantity);
            item.setPrice(product.getPrice());
            cart.getItems().add(item);
        }

        recalcTotal(cart);
        return cartRepository.save(cart);
    }

    @Transactional
    public Cart removeItem(Long customerId, Long productId) {
        Cart cart = getCartForCustomer(customerId);
        cart.getItems().removeIf(i -> i.getProduct().getId().equals(productId));
        recalcTotal(cart);
        return cartRepository.save(cart);
    }

    @Transactional
    public PurchaseOrder checkout(Long customerId) {
        Cart cart = getCartForCustomer(customerId);
        if (cart.getItems().isEmpty()) throw new IllegalStateException("Cart is empty");

        List<OrderItem> orderItems = cart.getItems().stream().map(ci -> {
            OrderItem oi = new OrderItem();
            oi.setProduct(ci.getProduct());
            oi.setQuantity(ci.getQuantity());
            oi.setPrice(ci.getPrice());
            return oi;
        }).collect(Collectors.toList());

        PurchaseOrder order = orderService.placeOrder(customerId, orderItems);
        // clear cart
        cart.getItems().clear();
        cart.setTotal(BigDecimal.ZERO);
        cartRepository.save(cart);
        return order;
    }

    private void recalcTotal(Cart cart) {
        BigDecimal total = cart.getItems().stream()
                .map(i -> i.getPrice().multiply(BigDecimal.valueOf(i.getQuantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        cart.setTotal(total);
    }
}
