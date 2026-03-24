// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MortgageContract is Ownable, ReentrancyGuard {
    using Address for address payable;

    enum LoanStatus {
        Pending,
        Approved,
        Rejected,
        Active,
        Completed,
        Defaulted,
        Cancelled
    }

    struct Loan {
        uint256 id;
        bool exists;
        address borrower;
        address lender;
        address reviewedBy;
        uint256 nftId;
        address nftContract;
        uint256 loanAmount;
        uint256 interestRate;
        uint256 durationMonths;
        uint256 emiAmount;
        uint256 totalPayable;
        uint256 amountPaid;
        uint256 remainingBalance;
        uint256 emisPaid;
        uint256 nextDueDate;
        uint256 createdAt;
        bool approved;
        bool funded;
        LoanStatus status;
    }

    uint256 private _nextLoanId = 1;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    mapping(address => bool) public authorizedLenders;
    mapping(bytes32 => bool) public lockedCollateral;

    event LenderAuthorizationUpdated(address indexed lender, bool authorized);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 interestRate);
    event LoanApplied(uint256 indexed loanId, address indexed borrower, uint256 nftId, uint256 amount);
    event LoanApproved(uint256 indexed loanId, address indexed lender);
    event LoanRejected(uint256 indexed loanId, address indexed lender);
    event LoanFunded(uint256 indexed loanId, address indexed lender, uint256 amount);
    event EMIPaid(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 emisPaid);
    event LoanCompleted(uint256 indexed loanId, address indexed borrower);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, address indexed lender);
    event LoanCancelled(uint256 indexed loanId, address indexed borrower);

    modifier validLoan(uint256 loanId) {
        require(loans[loanId].exists, "Loan not found");
        _;
    }

    modifier onlyBorrower(uint256 loanId) {
        require(loans[loanId].borrower == msg.sender, "Only borrower");
        _;
    }

    modifier onlyLender() {
        require(authorizedLenders[msg.sender], "Only lender");
        _;
    }

    constructor(address[] memory initialLenders) Ownable(msg.sender) {
        for (uint256 index = 0; index < initialLenders.length; index++) {
            _setLenderAuthorization(initialLenders[index], true);
        }
    }

    function setLenderAuthorization(address lender, bool isAuthorized) external onlyOwner {
        _setLenderAuthorization(lender, isAuthorized);
    }

    function createLoan(uint256 amount, uint256 interestRate) external returns (uint256) {
        uint256 loanId = _createLoan(
            msg.sender,
            address(0),
            0,
            amount,
            interestRate,
            12
        );

        emit LoanCreated(loanId, msg.sender, amount, interestRate);
        return loanId;
    }

    function applyLoan(
        address nftContract,
        uint256 nftId,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 durationMonths
    ) external returns (uint256) {
        require(nftContract != address(0), "NFT contract required");
        require(nftId > 0, "NFT id required");
        require(IERC721(nftContract).ownerOf(nftId) == msg.sender, "Not NFT owner");

        bytes32 collateralKey = _collateralKey(nftContract, nftId);
        require(!lockedCollateral[collateralKey], "Collateral already locked");

        IERC721(nftContract).transferFrom(msg.sender, address(this), nftId);
        lockedCollateral[collateralKey] = true;

        uint256 loanId = _createLoan(
            msg.sender,
            nftContract,
            nftId,
            loanAmount,
            interestRate,
            durationMonths
        );

        emit LoanApplied(loanId, msg.sender, nftId, loanAmount);
        return loanId;
    }

    function approveLoan(uint256 loanId) external onlyLender validLoan(loanId) {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Pending, "Loan not pending");
        require(!loan.approved, "Already approved");

        loan.approved = true;
        loan.reviewedBy = msg.sender;
        loan.status = LoanStatus.Approved;

        emit LoanApproved(loanId, msg.sender);
    }

    function rejectLoan(uint256 loanId) external onlyLender validLoan(loanId) {
        Loan storage loan = loans[loanId];

        require(
            loan.status == LoanStatus.Pending ||
                (loan.status == LoanStatus.Approved && loan.reviewedBy == msg.sender),
            "Loan not reviewable"
        );
        require(!loan.funded, "Loan already funded");

        loan.approved = false;
        loan.reviewedBy = msg.sender;
        loan.status = LoanStatus.Rejected;

        emit LoanRejected(loanId, msg.sender);
    }

    function fundLoan(uint256 loanId) external payable onlyLender validLoan(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Approved, "Loan not approved");
        require(loan.reviewedBy == msg.sender, "Only reviewing lender can fund");
        require(!loan.funded, "Loan already funded");
        require(msg.value == loan.loanAmount, "Incorrect funding amount");

        loan.lender = msg.sender;
        loan.funded = true;
        loan.status = LoanStatus.Active;
        loan.nextDueDate = block.timestamp + 30 days;

        payable(loan.borrower).sendValue(msg.value);

        emit LoanFunded(loanId, msg.sender, msg.value);
    }

    function payEMI(uint256 loanId) external payable validLoan(loanId) onlyBorrower(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Active, "Loan not active");
        require(loan.lender != address(0), "Lender missing");

        uint256 dueAmount = loan.remainingBalance < loan.emiAmount
            ? loan.remainingBalance
            : loan.emiAmount;
        require(dueAmount > 0, "Loan already settled");
        require(msg.value >= dueAmount, "Insufficient EMI amount");

        loan.amountPaid += dueAmount;
        loan.remainingBalance = loan.totalPayable > loan.amountPaid
            ? loan.totalPayable - loan.amountPaid
            : 0;
        loan.emisPaid += 1;
        loan.nextDueDate = block.timestamp + 30 days;

        payable(loan.lender).sendValue(dueAmount);

        if (msg.value > dueAmount) {
            payable(msg.sender).sendValue(msg.value - dueAmount);
        }

        emit EMIPaid(loanId, msg.sender, dueAmount, loan.emisPaid);

        if (loan.remainingBalance == 0 || loan.emisPaid >= loan.durationMonths) {
            _completeLoan(loanId);
        }
    }

    function cancelPendingLoan(uint256 loanId) external validLoan(loanId) onlyBorrower(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(
            loan.status == LoanStatus.Pending || loan.status == LoanStatus.Rejected,
            "Loan cannot be cancelled"
        );

        loan.approved = false;
        loan.status = LoanStatus.Cancelled;
        loan.remainingBalance = 0;

        _releaseCollateralToBorrower(loan);

        emit LoanCancelled(loanId, loan.borrower);
    }

    function triggerDefault(uint256 loanId) external validLoan(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Active, "Loan not active");
        require(loan.lender == msg.sender, "Only lender");
        require(block.timestamp > loan.nextDueDate + 7 days, "Loan not overdue");

        loan.status = LoanStatus.Defaulted;

        _releaseCollateralToLender(loan);

        emit LoanDefaulted(loanId, loan.borrower, loan.lender);
    }

    function getLoan(uint256 loanId) external view validLoan(loanId) returns (Loan memory) {
        return loans[loanId];
    }

    function viewLoanDetails(uint256 loanId) external view validLoan(loanId) returns (Loan memory) {
        return loans[loanId];
    }

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    function getNextLoanId() external view returns (uint256) {
        return _nextLoanId;
    }

    function isOverdue(uint256 loanId) external view validLoan(loanId) returns (bool) {
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Active || loan.nextDueDate == 0) {
            return false;
        }

        return block.timestamp > loan.nextDueDate + 7 days;
    }

    function _createLoan(
        address borrower,
        address nftContract,
        uint256 nftId,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 durationMonths
    ) internal returns (uint256 loanId) {
        require(borrower != address(0), "Borrower required");
        require(loanAmount > 0, "Loan amount must be > 0");
        require(interestRate > 0, "Interest rate must be > 0");
        require(durationMonths > 0, "Duration must be > 0");

        uint256 totalInterest = (loanAmount * interestRate * durationMonths) / (12 * 10000);
        uint256 totalPayable = loanAmount + totalInterest;
        uint256 emiAmount = totalPayable / durationMonths;

        if (emiAmount == 0) {
            emiAmount = totalPayable;
        }

        loanId = _nextLoanId++;
        loans[loanId] = Loan({
            id: loanId,
            exists: true,
            borrower: borrower,
            lender: address(0),
            reviewedBy: address(0),
            nftId: nftId,
            nftContract: nftContract,
            loanAmount: loanAmount,
            interestRate: interestRate,
            durationMonths: durationMonths,
            emiAmount: emiAmount,
            totalPayable: totalPayable,
            amountPaid: 0,
            remainingBalance: totalPayable,
            emisPaid: 0,
            nextDueDate: 0,
            createdAt: block.timestamp,
            approved: false,
            funded: false,
            status: LoanStatus.Pending
        });

        borrowerLoans[borrower].push(loanId);
    }

    function _completeLoan(uint256 loanId) internal {
        Loan storage loan = loans[loanId];

        loan.status = LoanStatus.Completed;
        loan.remainingBalance = 0;

        _releaseCollateralToBorrower(loan);

        emit LoanCompleted(loanId, loan.borrower);
    }

    function _releaseCollateralToBorrower(Loan storage loan) internal {
        if (loan.nftContract == address(0) || loan.nftId == 0) {
            return;
        }

        bytes32 collateralKey = _collateralKey(loan.nftContract, loan.nftId);
        if (!lockedCollateral[collateralKey]) {
            return;
        }

        lockedCollateral[collateralKey] = false;
        IERC721(loan.nftContract).transferFrom(address(this), loan.borrower, loan.nftId);
    }

    function _releaseCollateralToLender(Loan storage loan) internal {
        if (loan.nftContract == address(0) || loan.nftId == 0) {
            return;
        }

        bytes32 collateralKey = _collateralKey(loan.nftContract, loan.nftId);
        if (!lockedCollateral[collateralKey]) {
            return;
        }

        lockedCollateral[collateralKey] = false;
        IERC721(loan.nftContract).transferFrom(address(this), loan.lender, loan.nftId);
    }

    function _setLenderAuthorization(address lender, bool isAuthorized) internal {
        require(lender != address(0), "Invalid lender");
        authorizedLenders[lender] = isAuthorized;
        emit LenderAuthorizationUpdated(lender, isAuthorized);
    }

    function _collateralKey(address nftContract, uint256 nftId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(nftContract, nftId));
    }
}
