# ChipIn - Money Gathering on Celestia

A modern money gathering application built on Celestia blockchain using OnChainDB for decentralized data storage.

## Features

- Create money gatherings for trips, events, group purchases
- Contribute TIA tokens via Keplr wallet
- Real-time progress tracking stored on blockchain
- Beautiful glass morphism UI design

## Prerequisites

- Python 3.9+
- Keplr wallet browser extension
- TIA tokens on Celestia Mocha Testnet

## Local Development

1. Install the OnChainDB SDK:
```bash
cd ../sdk-python
pip install -e .
```

2. Install app dependencies:
```bash
cd ../gathering-app
pip install -r requirements.txt
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your OnChainDB credentials
```

4. Initialize the database indexes:
```bash
python scripts/create_indexes.py
```

5. Run the development server:
```bash
flask run --debug
```

Visit http://localhost:5000

## AWS Elastic Beanstalk Deployment

1. Install EB CLI:
```bash
pip install awsebcli
```

2. Initialize EB:
```bash
eb init -p python-3.11 chipin-app
```

3. Create environment:
```bash
eb create chipin-production
```

4. Set environment variables:
```bash
eb setenv ONCHAINDB_ENDPOINT=https://your-endpoint.onchaindb.io \
          ONCHAINDB_APP_ID=your-app-id \
          ONCHAINDB_APP_KEY=your-app-key \
          BROKER_ADDRESS=celestia1... \
          DEBUG=false
```

5. Deploy:
```bash
eb deploy
```

## Project Structure

```
gathering-app/
├── app.py                 # Flask routes and API
├── config.py              # Configuration
├── services/
│   └── gathering_service.py  # OnChainDB business logic
├── templates/
│   └── index.html         # Frontend SPA
├── static/
│   └── js/
│       ├── app.js         # Application logic
│       └── keplr.js       # Wallet integration
├── scripts/
│   └── create_indexes.py  # Database initialization
├── .ebextensions/         # AWS EB configuration
├── .platform/             # Nginx configuration
└── Procfile               # Gunicorn config
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gatherings` | GET | List gatherings |
| `/api/gatherings` | POST | Create gathering |
| `/api/gatherings/<id>` | GET | Get gathering details |
| `/api/gatherings/<id>/contribute` | POST | Add contribution |
| `/api/stats` | GET | Platform statistics |
| `/api/celestia/balance/<addr>` | GET | Get wallet balance |
| `/api/celestia/broadcast` | POST | Broadcast transaction |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ONCHAINDB_ENDPOINT` | OnChainDB API endpoint | Required |
| `ONCHAINDB_APP_ID` | Your application ID | Required |
| `ONCHAINDB_APP_KEY` | Your application key | Required |
| `BROKER_ADDRESS` | Celestia broker address | Required |
| `DEBUG` | Enable debug mode | false |
| `MIN_CONTRIBUTION_UTIA` | Minimum contribution | 100000 |
| `CREATION_FEE_UTIA` | Gathering creation fee | 500000 |

## License

MIT
