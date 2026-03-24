// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract PropertyEscrow is Ownable {
    struct EscrowPosition {
        address borrower;
        address lender;
        bool locked;
        bool seized;
    }

    address public controller;
    mapping(bytes32 => EscrowPosition) public escrowPositions;

    event ControllerUpdated(address indexed controller);
    event PropertyLocked(address indexed nftContract, uint256 indexed tokenId, address indexed borrower);
    event PropertyReleasedToBorrower(address indexed nftContract, uint256 indexed tokenId, address indexed borrower);
    event PropertySeizedToLender(address indexed nftContract, uint256 indexed tokenId, address indexed lender);

    modifier onlyController() {
        require(msg.sender == controller, "Only controller");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setController(address newController) external onlyOwner {
        require(newController != address(0), "Invalid controller");
        controller = newController;
        emit ControllerUpdated(newController);
    }

    function lockProperty(address nftContract, uint256 tokenId, address borrower) external onlyController {
        bytes32 key = propertyKey(nftContract, tokenId);
        EscrowPosition storage position = escrowPositions[key];

        require(!position.locked, "Property already locked");

        IERC721(nftContract).transferFrom(borrower, address(this), tokenId);
        escrowPositions[key] = EscrowPosition({
            borrower: borrower,
            lender: address(0),
            locked: true,
            seized: false
        });

        emit PropertyLocked(nftContract, tokenId, borrower);
    }

    function releaseToBorrower(address nftContract, uint256 tokenId) external onlyController {
        bytes32 key = propertyKey(nftContract, tokenId);
        EscrowPosition storage position = escrowPositions[key];

        require(position.locked, "Property not locked");

        address borrower = position.borrower;
        position.locked = false;
        position.seized = false;
        position.lender = address(0);

        IERC721(nftContract).transferFrom(address(this), borrower, tokenId);
        emit PropertyReleasedToBorrower(nftContract, tokenId, borrower);
    }

    function seizeToLender(address nftContract, uint256 tokenId, address lender) external onlyController {
        bytes32 key = propertyKey(nftContract, tokenId);
        EscrowPosition storage position = escrowPositions[key];

        require(position.locked, "Property not locked");
        require(lender != address(0), "Invalid lender");

        position.locked = false;
        position.seized = true;
        position.lender = lender;

        IERC721(nftContract).transferFrom(address(this), lender, tokenId);
        emit PropertySeizedToLender(nftContract, tokenId, lender);
    }

    function propertyKey(address nftContract, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(nftContract, tokenId));
    }
}
