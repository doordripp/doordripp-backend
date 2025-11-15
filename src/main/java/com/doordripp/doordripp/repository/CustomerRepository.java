package com.doordripp.doordripp.repository;

import com.doordripp.doordripp.model.Customer;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
	java.util.Optional<com.doordripp.doordripp.model.Customer> findByEmail(String email);
}
