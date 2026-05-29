# Order Service

Orders require a customer id and a non-negative total. Validation belongs in
`src/orders/validator.js`, while `src/orders/service.js` owns persistence and
returned order shape.
